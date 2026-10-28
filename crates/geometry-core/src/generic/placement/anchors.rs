//! Exact port of Resin UV `rebuild_edge_candidates` (mixo3d/helpers/slasg_assets.py): safe inset
//! anchors along the physical boundaries and the internal ridges sharper than Ridge Angle of each
//! connected overhang region, sampled every `spacing` including both edge ends, inset perpendicular
//! into the first legal incident face by `radius`, and deduplicated within 0.9 x spacing in order.

use super::Source;
use crate::core::jsnum::{hypot, hypot3};
use crate::core::vec::{V3, add, cross, dot, normalize, scale, sub};
use std::collections::HashMap;

const MARGIN: f64 = 0.05;

pub struct Anchor {
    pub position: V3,
    pub normal: V3,
    pub source: Source,
}

pub struct AnchorSettings {
    /// Faces count as overhang when normal.y < -cos(angle).
    pub overhang_angle_degrees: f64,
    pub spacing: f64,
    /// Contact diameter / 2 + inset margin (0.05 mm).
    pub radius: f64,
    pub facing_down: bool,
    pub ridge_angle_degrees: f64,
}

fn angle_between(a: V3, b: V3) -> f64 {
    dot(a, b).clamp(-1.0, 1.0).acos()
}

fn face_basis(normal: V3) -> (V3, V3) {
    let helper = if normal[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    let u = normalize(cross(normal, helper));
    (u, cross(normal, u))
}

/// `_inside_with_clearance`: same-side winding against every edge and distance >= radius to all of them.
fn inside_with_clearance(point: V3, vertices: &[V3; 3], normal: V3, radius: f64) -> bool {
    let (u, v) = face_basis(normal);
    let origin = vertices[0];
    let poly: Vec<[f64; 2]> = vertices.iter().map(|x| [dot(sub(*x, origin), u), dot(sub(*x, origin), v)]).collect();
    let q = [dot(sub(point, origin), u), dot(sub(point, origin), v)];
    let mut sign: Option<bool> = None;
    let mut nearest = f64::INFINITY;
    for (index, a) in poly.iter().enumerate() {
        let b = poly[(index + 1) % poly.len()];
        let edge = [b[0] - a[0], b[1] - a[1]];
        let cross_value = edge[0] * (q[1] - a[1]) - edge[1] * (q[0] - a[0]);
        if cross_value.abs() > 1e-7 {
            let here = cross_value > 0.0;
            match sign {
                None => sign = Some(here),
                Some(s) if s != here => nearest = f64::NEG_INFINITY,
                _ => {}
            }
        }
        let length_squared = (edge[0] * edge[0] + edge[1] * edge[1]).max(1e-12);
        let t = (((q[0] - a[0]) * edge[0] + (q[1] - a[1]) * edge[1]) / length_squared).clamp(0.0, 1.0).max(0.0);
        if nearest != f64::NEG_INFINITY {
            nearest = nearest.min(hypot(&[q[0] - (a[0] + edge[0] * t), q[1] - (a[1] + edge[1] * t)]));
        }
    }
    nearest != f64::NEG_INFINITY && nearest + 1e-6 >= radius
}

struct Edge {
    key: (u32, u32),
    faces: Vec<usize>,
}

pub fn edge_anchors(positions: &[f32], indices: &[u32], s: &AnchorSettings) -> Vec<Anchor> {
    let face_count = indices.len() / 3;
    let vertex = |index: u32| -> V3 {
        let o = index as usize * 3;
        [f64::from(positions[o]), f64::from(positions[o + 1]), f64::from(positions[o + 2])]
    };
    let face_vertices = |face: usize| [indices[face * 3], indices[face * 3 + 1], indices[face * 3 + 2]];
    let normals: Vec<V3> = (0..face_count)
        .map(|face| {
            let [a, b, c] = face_vertices(face).map(vertex);
            normalize(cross(sub(b, a), sub(c, a)))
        })
        .collect();
    let radius = s.radius;
    let spacing = s.spacing.max(0.2);
    // Resin UV rounds Ridge Angle to 1e-4 degree, so 45 is exactly pi / 4 in both.
    let sharp_angle = s.ridge_angle_degrees * std::f64::consts::PI / 180.0;
    let threshold = -(s.overhang_angle_degrees * std::f64::consts::PI / 180.0).cos();
    let mut eligible = vec![false; face_count];
    if s.facing_down {
        for face in 0..face_count {
            eligible[face] = normals[face][1] < threshold;
        }
    }

    // Edge -> incident faces, in polygon order (Python dict insertion order).
    let mut all_edges: Vec<Edge> = Vec::new();
    let mut edge_index: HashMap<(u32, u32), usize> = HashMap::new();
    for face in 0..face_count {
        let ids = face_vertices(face);
        for k in 0..3 {
            let (a, b) = (ids[k], ids[(k + 1) % 3]);
            let key = if a < b { (a, b) } else { (b, a) };
            match edge_index.get(&key) {
                Some(&e) => all_edges[e].faces.push(face),
                None => {
                    edge_index.insert(key, all_edges.len());
                    all_edges.push(Edge { key, faces: vec![face] });
                }
            }
        }
    }

    let mut neighbours: Vec<Vec<usize>> = vec![Vec::new(); face_count];
    for edge in &all_edges {
        let inside: Vec<usize> = edge.faces.iter().copied().filter(|&f| eligible[f]).collect();
        if edge.faces.len() == 2 && inside.len() == 2 {
            neighbours[inside[0]].push(inside[1]);
            neighbours[inside[1]].push(inside[0]);
        }
    }
    // Regions follow their smallest face index.
    let mut region_of: Vec<Option<usize>> = vec![None; face_count];
    let mut region_count = 0;
    for start in 0..face_count {
        if !eligible[start] || region_of[start].is_some() {
            continue;
        }
        region_of[start] = Some(region_count);
        let mut todo = vec![start];
        while let Some(face) = todo.pop() {
            for &other in &neighbours[face] {
                if region_of[other].is_none() {
                    region_of[other] = Some(region_count);
                    todo.push(other);
                }
            }
        }
        region_count += 1;
    }

    let mut points: Vec<Anchor> = Vec::new();
    let append_inset = |points: &mut Vec<Anchor>, edge_point: V3, edge_direction: V3, faces: &[usize], source: Source| -> bool {
        for &face in faces {
            let verts = face_vertices(face).map(vertex);
            let sum = verts.iter().fold([0.0; 3], |acc, v| add(acc, *v));
            let centre = scale(sum, 1.0 / verts.len() as f64);
            let mut inward = cross(normals[face], edge_direction);
            if dot(inward, sub(centre, edge_point)) < 0.0 {
                inward = scale(inward, -1.0);
            }
            if hypot3(inward) < 1e-8 {
                continue;
            }
            let direction = normalize(inward);
            let requested = radius + 1e-4;
            let mut candidate = add(edge_point, scale(direction, requested));
            if !inside_with_clearance(candidate, &verts, normals[face], radius) {
                let clearance = MARGIN.min(radius * 0.25);
                let mut legal: Option<V3> = None;
                for step in 1..=16 {
                    let probe = add(edge_point, scale(direction, requested * f64::from(step) / 16.0));
                    if inside_with_clearance(probe, &verts, normals[face], clearance) {
                        legal = Some(probe);
                    }
                }
                let Some(legal) = legal else { continue };
                candidate = legal;
            }
            if !points.iter().any(|prior| hypot3(sub(candidate, prior.position)) < spacing * 0.9) {
                points.push(Anchor { position: candidate, normal: normals[face], source });
            }
            return true;
        }
        false
    };

    // Each region's edges in edge order, gathered in one pass.
    let mut region_edges: Vec<Vec<usize>> = vec![Vec::new(); region_count];
    for (e, edge) in all_edges.iter().enumerate() {
        if edge.faces.len() != 1 && edge.faces.len() != 2 {
            continue;
        }
        let mut touched: Vec<usize> = Vec::new();
        for &face in &edge.faces {
            if let Some(index) = region_of[face] {
                if !touched.contains(&index) {
                    touched.push(index);
                }
            }
        }
        for index in touched {
            region_edges[index].push(e);
        }
    }

    for (index, edges) in region_edges.iter().enumerate() {
        for &e in edges {
            let Edge { key, faces } = &all_edges[e];
            let inside: Vec<usize> = faces.iter().copied().filter(|&f| region_of[f] == Some(index)).collect();
            let boundary = inside.len() == 1;
            let ridge = faces.len() == 2 && inside.len() == 2 && angle_between(normals[faces[0]], normals[faces[1]]) > sharp_angle;
            if !(boundary || ridge) {
                continue;
            }
            let (a, b) = (vertex(key.0), vertex(key.1));
            let direction = sub(b, a);
            let count = ((hypot3(direction) / spacing).ceil()).max(1.0) as usize;
            let fractions: Vec<f64> = if count == 1 { vec![0.5] } else { (0..=count).map(|n| n as f64 / count as f64).collect() };
            let source = if boundary { Source::PhysicalBoundary } else { Source::SharpRidge };
            for fraction in fractions {
                append_inset(&mut points, add(a, scale(direction, fraction)), direction, &inside, source);
            }
        }
    }
    points
}
