//! The cavity rim: the sharp loop pair at the aligner's lower terminal (authorising loop), or a
//! projection fallback, plus the orthographic visibility footprint of the opening.

use super::mesh::{Mesh, sum_points};

use crate::core::vec::{V3, cross, dot, length, normalize, scale, sub};
use crate::core::jsnum::hypot3;
use super::profiles::AlignerProfile;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryKind {
    /// Only a paired lower-edge loop may authorise automatic dental supports.
    LowerEdgeLoop,
    ProjectionFallback,
}

/// Mesh-frame closed rim loop, opening frame and visibility footprint.
#[derive(Clone, Debug)]
pub struct Rim {
    pub boundary_kind: BoundaryKind,
    pub points: Vec<f32>,
    pub opening_direction: V3,
    pub centroid: V3,
    pub tangent: V3,
    pub bitangent: V3,
    pub visibility_mask: Vec<u8>,
    pub visibility_resolution: usize,
    pub visibility_min: [f64; 2],
    pub visibility_max: [f64; 2],
}

const RESOLUTION: usize = 96;

pub fn stable_tangent(axis: V3) -> V3 {
    let reference = if axis[0].abs() < 0.8 { [1.0, 0.0, 0.0] } else { [0.0, 0.0, 1.0] };
    normalize(cross(reference, axis))
}

pub fn trace_rim(mesh: &Mesh, vertices: &[V3], centre: V3, opening: V3, profile: &AlignerProfile) -> Option<Rim> {
    let projection: Vec<f64> = vertices.iter().map(|p| dot(sub(*p, centre), opening)).collect();
    let minimum = projection.iter().cloned().fold(f64::INFINITY, f64::min);
    let maximum = projection.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let tangent = stable_tangent(opening);
    let bitangent = normalize(cross(opening, tangent));
    if let Some(boundary) = lower_feature_loop(mesh, vertices, &projection, (minimum, maximum), centre, (tangent, bitangent), profile) {
        return Some(make_rim(mesh, &boundary, opening, tangent, bitangent, BoundaryKind::LowerEdgeLoop));
    }
    let cutoff = maximum - (maximum - minimum) * 0.025;
    let candidates: Vec<V3> = vertices.iter().zip(&projection).filter(|(_, p)| **p >= cutoff).map(|(v, _)| *v).collect();
    if candidates.len() < 6 {
        return None;
    }
    let cap_centre = scale(sum_points(candidates.iter().copied()), 1.0 / candidates.len() as f64);
    let radial: Vec<f64> = candidates
        .iter()
        .map(|point| {
            let along = dot(sub(*point, cap_centre), opening);
            let on_axis = [cap_centre[0] + opening[0] * along, cap_centre[1] + opening[1] * along, cap_centre[2] + opening[2] * along];
            length(sub(*point, on_axis))
        })
        .collect();
    let mut sorted = radial.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let minimum_radius = sorted[0];
    let median = sorted[radial.len() / 2];
    let inner_limit = minimum_radius + (median - minimum_radius) / 2.0;
    let mut loop_points: Vec<V3> = candidates.iter().zip(&radial).filter(|(_, r)| **r <= inner_limit + 1e-6).map(|(p, _)| *p).collect();
    sort_by_angle(&mut loop_points, cap_centre, tangent, bitangent);
    if loop_points.len() < 6 {
        return None;
    }
    Some(make_rim(mesh, &loop_points, opening, tangent, bitangent, BoundaryKind::ProjectionFallback))
}

fn angle_of(point: V3, centre: V3, tangent: V3, bitangent: V3) -> f64 {
    let d = sub(point, centre);
    dot(d, bitangent).atan2(dot(d, tangent))
}

fn sort_by_angle(points: &mut [V3], centre: V3, tangent: V3, bitangent: V3) {
    points.sort_by(|a, b| {
        let (x, y) = (angle_of(*a, centre, tangent, bitangent), angle_of(*b, centre, tangent, bitangent));
        (x - y).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
}

fn make_rim(mesh: &Mesh, loop_points: &[V3], opening: V3, tangent: V3, bitangent: V3, boundary_kind: BoundaryKind) -> Rim {
    let centroid = scale(sum_points(loop_points.iter().copied()), 1.0 / loop_points.len() as f64);
    let (mask, min, max) = rasterize_visible_surface(mesh, centroid, opening, tangent, bitangent);
    Rim {
        boundary_kind,
        points: loop_points.iter().flat_map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect(),
        opening_direction: opening,
        centroid,
        tangent,
        bitangent,
        visibility_mask: mask,
        visibility_resolution: RESOLUTION,
        visibility_min: min,
        visibility_max: max,
    }
}

/// The support boundary of a closed aligner is the innermost sharp loop at its lower terminal.
fn lower_feature_loop(
    mesh: &Mesh,
    vertices: &[V3],
    projection: &[f64],
    (minimum, maximum): (f64, f64),
    centre: V3,
    (tangent, bitangent): (V3, V3),
    profile: &AlignerProfile,
) -> Option<Vec<V3>> {
    let t = &profile.thresholds;
    // Edges in first-seen order: (a, b, faces).
    let mut order: Vec<(u32, u32, Vec<u32>)> = Vec::new();
    let mut slot: HashMap<(u32, u32), usize> = HashMap::new();
    let mut normals: Vec<V3> = Vec::with_capacity(mesh.face_count());
    for face in 0..mesh.face_count() {
        let [a, b, c] = mesh.face_points(face);
        normals.push(normalize(cross(sub(b, a), sub(c, a))));
        for corner in 0..3 {
            let a = mesh.corner(face, corner);
            let b = mesh.corner(face, (corner + 1) % 3);
            let key = (a.min(b), a.max(b));
            match slot.get(&key) {
                Some(&at) => order[at].2.push(face as u32),
                None => {
                    slot.insert(key, order.len());
                    order.push((a, b, vec![face as u32]));
                }
            }
        }
    }
    let sharp = (t.sharp_angle_deg * std::f64::consts::PI / 180.0).cos();
    let mut graph: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut keys: Vec<u32> = Vec::new();
    let mut link = |from: u32, to: u32| {
        let entry = graph.entry(from).or_insert_with(|| {
            keys.push(from);
            Vec::new()
        });
        entry.push(to);
    };
    for (a, b, faces) in &order {
        if faces.len() != 2 || dot(normals[faces[0] as usize], normals[faces[1] as usize]).abs() > sharp {
            continue;
        }
        link(*a, *b);
        link(*b, *a);
    }
    let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::new();
    let mut loops: Vec<Vec<u32>> = Vec::new();
    for &start in &keys {
        if seen.contains(&start) {
            continue;
        }
        let mut component = Vec::new();
        let mut queue = vec![start];
        seen.insert(start);
        while let Some(current) = queue.pop() {
            component.push(current);
            for &next in &graph[&current] {
                if seen.insert(next) {
                    queue.push(next);
                }
            }
        }
        if component.len() >= t.loop_min_vertices && component.iter().all(|v| graph[v].len() == 2) {
            loops.push(component);
        }
    }
    if loops.is_empty() {
        return None;
    }
    let depth_of = |l: &[u32]| l.iter().fold(0.0, |s, &i| s + projection[i as usize]) / l.len() as f64;
    let lowest = loops.iter().map(|l| depth_of(l)).fold(f64::INFINITY, f64::min);
    let band = ((maximum - minimum) * t.loop_band_fraction).max(t.loop_band_min_mm);
    let mut terminal: Vec<Vec<u32>> = loops.into_iter().filter(|l| depth_of(l) <= lowest + band).collect();
    if terminal.len() < 2 {
        return None;
    }
    let radius_of = |l: &[u32]| {
        l.iter().fold(0.0, |s, &i| {
            let d = sub(vertices[i as usize], centre);
            s + hypot3([dot(d, tangent), dot(d, bitangent), 0.0])
        }) / l.len() as f64
    };
    terminal.sort_by(|a, b| (radius_of(a) - radius_of(b)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    let (selected, outer) = (&terminal[0], &terminal[1]);
    if radius_of(selected) / radius_of(outer) < t.loop_radius_ratio_min {
        return None;
    }
    // A local cavity or attachment can form a closed sharp pair; it is only an aligner trim when
    // it spans the arch in both in-plane directions.
    let extent = |indices: &mut dyn Iterator<Item = u32>, axis: V3| {
        let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
        for i in indices {
            let value = dot(sub(vertices[i as usize], centre), axis);
            low = low.min(value);
            high = high.max(value);
        }
        high - low
    };
    for axis in [tangent, bitangent] {
        let global = extent(&mut (0..vertices.len() as u32), axis);
        if !(global > 0.0)
            || extent(&mut selected.iter().copied(), axis) / global < t.loop_extent_min
            || extent(&mut outer.iter().copied(), axis) / global < t.loop_extent_min
        {
            return None;
        }
    }
    let mut points: Vec<V3> = selected.iter().map(|&i| vertices[i as usize]).collect();
    let loop_centre = scale(sum_points(points.iter().copied()), 1.0 / points.len() as f64);
    sort_by_angle(&mut points, loop_centre, tangent, bitangent);
    Some(points)
}

/// Orthographic first-surface coverage of the opening in the rim frame (96 x 96 cells).
fn rasterize_visible_surface(mesh: &Mesh, centre: V3, axis: V3, tangent: V3, bitangent: V3) -> (Vec<u8>, [f64; 2], [f64; 2]) {
    let (mut min_u, mut min_v, mut max_u, mut max_v) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for vertex in 0..mesh.vertex_count() as u32 {
        let delta = sub(mesh.point(vertex), centre);
        let (u, v) = (dot(delta, tangent), dot(delta, bitangent));
        min_u = min_u.min(u);
        min_v = min_v.min(v);
        max_u = max_u.max(u);
        max_v = max_v.max(v);
    }
    let width = (max_u - min_u).max(1e-6);
    let height = (max_v - min_v).max(1e-6);
    let res = RESOLUTION as f64;
    let mut depth = vec![f64::NEG_INFINITY; RESOLUTION * RESOLUTION];
    let project = |p: V3| {
        let d = sub(p, centre);
        [dot(d, tangent), dot(d, bitangent), dot(d, axis)]
    };
    for face in 0..mesh.face_count() {
        let [pa, pb, pc] = mesh.face_points(face);
        let (a, b, c) = (project(pa), project(pb), project(pc));
        let denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if denominator.abs() < 1e-12 {
            continue;
        }
        let cell = |value: f64, low: f64, span: f64| ((value - low) / span * res).floor();
        let min_x = cell(a[0].min(b[0]).min(c[0]), min_u, width).max(0.0) as usize;
        let max_x = cell(a[0].max(b[0]).max(c[0]), min_u, width).min(res - 1.0);
        let min_y = cell(a[1].min(b[1]).min(c[1]), min_v, height).max(0.0) as usize;
        let max_y = cell(a[1].max(b[1]).max(c[1]), min_v, height).min(res - 1.0);
        if max_x < 0.0 || max_y < 0.0 {
            continue;
        }
        for y in min_y..=max_y as usize {
            for x in min_x..=max_x as usize {
                let u = min_u + ((x as f64 + 0.5) / res) * width;
                let v = min_v + ((y as f64 + 0.5) / res) * height;
                let l1 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / denominator;
                let l2 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / denominator;
                let l3 = 1.0 - l1 - l2;
                if l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9 {
                    continue;
                }
                let at = y * RESOLUTION + x;
                depth[at] = depth[at].max(l1 * a[2] + l2 * b[2] + l3 * c[2]);
            }
        }
    }
    let mask = depth.iter().map(|d| u8::from(d.is_finite())).collect();
    (mask, [min_u, min_v], [max_u, max_v])
}
