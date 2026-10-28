//! Intentional contact reach versus crossing: a built component may touch the model only where one
//! of its recorded contact intents proves it, within a bounded depth. Directions and depth are
//! measured against the intent face's own normal. Two cases are the tip itself:
//! - the intended surface: the intent face plus faces joined to it by shared indexed edges that face
//!   the same way and lie within the reach radius, so a dense mesh (triangles much smaller than a
//!   tip) does not turn the tip's own surface into a crossing;
//! - the tip seat: a face pointing another way, crossed only within the tip's allowed depth of the
//!   contact point, with the support no deeper than that behind the intent face, and joined to the
//!   intent face within that depth (the tip seats over an edge thinner than its depth, such as an
//!   aligner rim).
//! A separate wall is never joined, so it is never exempt. No face identity means no exemption.

use super::conflicts::{Conflict, SupportMesh};
use super::index::CollisionIndex;
use super::tri::{Tri, segment_triangle_hit};
use crate::core::vec::{V3, cross, distance, dot, length, sub};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug)]
pub struct ReachLimits {
    pub radius_mm: f64,
    pub penetration_mm: f64,
    pub face_normal_dot_min: f64,
}

fn vertex(positions: &[f32], index: u32) -> Option<V3> {
    let o = index as usize * 3;
    if o + 2 >= positions.len() {
        return None;
    }
    let p = [f64::from(positions[o]), f64::from(positions[o + 1]), f64::from(positions[o + 2])];
    p.iter().all(|v| v.is_finite()).then_some(p)
}

fn unit(v: V3) -> V3 {
    let size = length(v);
    [v[0] / size, v[1] / size, v[2] / size]
}

pub fn is_intentional_contact_reach(index: &CollisionIndex, supports: &SupportMesh, hit: &Conflict, limits: &ReachLimits) -> bool {
    if !limits.radius_mm.is_finite()
        || limits.radius_mm <= 0.0
        || !limits.penetration_mm.is_finite()
        || limits.penetration_mm < 0.0
        || !limits.face_normal_dot_min.is_finite()
        || !(-1.0..=1.0).contains(&limits.face_normal_dot_min)
    {
        return false;
    }
    let (model_positions, model_indices) = (index.positions, index.indices);
    let Some(component) = supports.components.get(hit.component) else { return false };
    let triangle_offset = hit.support_triangle * 3;
    let face_offset = hit.model_face * 3;
    if triangle_offset < component.start as usize || triangle_offset + 3 > (component.start + component.count) as usize || face_offset + 3 > model_indices.len() {
        return false;
    }
    let model_verts: Vec<Option<V3>> = model_indices[face_offset..face_offset + 3].iter().map(|&i| vertex(model_positions, i)).collect();
    let support_verts: Vec<Option<V3>> = supports.indices[triangle_offset..triangle_offset + 3].iter().map(|&i| vertex(supports.positions, i)).collect();
    if model_verts.iter().chain(&support_verts).any(Option::is_none) {
        return false;
    }
    let [a, b, c] = [model_verts[0].unwrap(), model_verts[1].unwrap(), model_verts[2].unwrap()];
    let face_cross = cross(sub(b, a), sub(c, a));
    if length(face_cross) == 0.0 {
        return false;
    }
    let face_normal = unit(face_cross);
    let support_points: Vec<V3> = support_verts.into_iter().map(Option::unwrap).collect();
    for intent in &component.tag.intents {
        let Some(face) = intent.face else { continue };
        let face = face as usize;
        if face * 3 + 3 > model_indices.len() || !intent.point.iter().all(|v| v.is_finite()) {
            continue;
        }
        // The surface is judged by the intent face's own normal. `intent.normal` is the neck
        // direction, which the build limits to the maximum neck angle (and, for generic contacts,
        // may take from the remesh), so it can be tens of degrees away from the face.
        let Some(normal) = face_normal_of(model_positions, model_indices, face) else { continue };
        if dot(normal, intent.normal) <= 0.0 {
            continue;
        }
        let seat = limits.penetration_mm;
        if crossings_within(&[support_points[0], support_points[1], support_points[2]], &[a, b, c], intent.point, seat)
            && support_points.iter().all(|&p| dot(sub(p, intent.point), normal) >= -seat)
            && (face == hit.model_face || joined(index, face, hit.model_face, &|f| box_distance(&index.face_bounds[f], intent.point) <= seat))
        {
            return true;
        }
        if dot(face_normal, normal) < limits.face_normal_dot_min {
            continue;
        }
        if face != hit.model_face && !same_surface(index, face, hit.model_face, intent.point, normal, limits) {
            continue;
        }
        if support_points.iter().all(|&p| distance(p, intent.point) <= limits.radius_mm && dot(sub(p, intent.point), normal) >= -limits.penetration_mm) {
            return true;
        }
    }
    false
}

fn face_normal_of(positions: &[f32], indices: &[u32], face: usize) -> Option<V3> {
    let corners: Vec<Option<V3>> = indices[face * 3..face * 3 + 3].iter().map(|&i| vertex(positions, i)).collect();
    let [a, b, c] = [corners[0]?, corners[1]?, corners[2]?];
    let n = cross(sub(b, a), sub(c, a));
    (length(n) > 0.0).then(|| unit(n))
}

/// True when `target` is reached from `source` across shared indexed edges, through faces that each
/// face within `face_normal_dot_min` of `normal` and whose bounds touch the reach sphere around `point`.
fn same_surface(index: &CollisionIndex, source: usize, target: usize, point: V3, normal: V3, limits: &ReachLimits) -> bool {
    let (positions, indices) = (index.positions, index.indices);
    joined(index, source, target, &|face| {
        face_normal_of(positions, indices, face).is_some_and(|n| dot(n, normal) >= limits.face_normal_dot_min)
            && box_distance(&index.face_bounds[face], point) <= limits.radius_mm
    })
}

/// True when `target` is reached from `source` across shared indexed edges through faces that all
/// pass `keep` (`source` too). Separate close walls with duplicate coordinates but different
/// vertices are never joined.
fn joined(index: &CollisionIndex, source: usize, target: usize, keep: &dyn Fn(usize) -> bool) -> bool {
    let indices = index.indices;
    if !keep(source) {
        return false;
    }
    let mut seen = HashSet::from([source]);
    let mut queue = vec![source];
    while let Some(face) = queue.pop() {
        let corners = &indices[face * 3..face * 3 + 3];
        for &v in corners {
            for &next in index.faces_at(v) {
                let next = next as usize;
                if seen.contains(&next) {
                    continue;
                }
                let shared = indices[next * 3..next * 3 + 3].iter().filter(|i| corners.contains(i)).count();
                if shared != 2 || !keep(next) {
                    continue;
                }
                if next == target {
                    return true;
                }
                seen.insert(next);
                queue.push(next);
            }
        }
    }
    false
}

fn box_distance(bounds: &super::index::Bounds, point: V3) -> f64 {
    let gap = |axis: usize| (bounds.min[axis] - point[axis]).max(point[axis] - bounds.max[axis]).max(0.0);
    length([gap(0), gap(1), gap(2)])
}

/// True when the two triangles cross and every crossing point lies within `seat_mm` of `point`.
/// Coplanar overlaps give no crossing points and so never qualify.
fn crossings_within(support: &Tri, face: &Tri, point: V3, seat_mm: f64) -> bool {
    let mut crossings = Vec::new();
    for (from, onto) in [(support, face), (face, support)] {
        for k in 0..3 {
            let (p, q) = (from[k], from[(k + 1) % 3]);
            if let Some(t) = segment_triangle_hit(p, q, onto) {
                crossings.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])]);
            }
        }
    }
    !crossings.is_empty() && crossings.iter().all(|&c| distance(c, point) <= seat_mm)
}
