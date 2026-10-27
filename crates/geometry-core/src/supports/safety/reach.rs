//! Intentional contact reach versus crossing (port of TS `contactReach.ts`): a built component may
//! touch the model only where one of its recorded contact intents proves it, face-locally and within
//! a bounded depth. No face identity means no exemption.

use super::conflicts::{Conflict, SupportMesh};
use crate::supports::parts::vec::{V3, cross, dot, length, sub};

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

fn distance(a: V3, b: V3) -> f64 {
    crate::supports::remesh::hypot3(sub(a, b))
}

pub fn is_intentional_contact_reach(model_positions: &[f32], model_indices: &[u32], supports: &SupportMesh, hit: &Conflict, limits: &ReachLimits) -> bool {
    if !limits.radius_mm.is_finite()
        || limits.radius_mm <= 0.0
        || !limits.penetration_mm.is_finite()
        || limits.penetration_mm < 0.0
        || !limits.face_normal_dot_min.is_finite()
        || !(-1.0..=1.0).contains(&limits.face_normal_dot_min)
    {
        return false;
    }
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
        if face * 3 + 3 > model_indices.len() || !intent.point.iter().all(|v| v.is_finite()) || !intent.normal.iter().all(|v| v.is_finite()) || length(intent.normal) == 0.0 {
            continue;
        }
        let normal = unit(intent.normal);
        if dot(face_normal, normal) < limits.face_normal_dot_min {
            continue;
        }
        if face != hit.model_face {
            // One shared indexed edge is the narrowest useful smooth-surface neighbourhood.
            // Separate close walls with duplicate coordinates but different vertices are not connected.
            let source = &model_indices[face * 3..face * 3 + 3];
            let target = &model_indices[face_offset..face_offset + 3];
            if source.iter().filter(|i| target.contains(i)).count() != 2 {
                continue;
            }
            let source_verts: Vec<Option<V3>> = source.iter().map(|&i| vertex(model_positions, i)).collect();
            if source_verts.iter().any(Option::is_none) {
                continue;
            }
            let [u, v, w] = [source_verts[0].unwrap(), source_verts[1].unwrap(), source_verts[2].unwrap()];
            let source_cross = cross(sub(v, u), sub(w, u));
            if length(source_cross) == 0.0 || dot(unit(source_cross), normal) < limits.face_normal_dot_min {
                continue;
            }
        }
        if support_points.iter().all(|&p| distance(p, intent.point) <= limits.radius_mm && dot(sub(p, intent.point), normal) >= -limits.penetration_mm) {
            return true;
        }
    }
    false
}
