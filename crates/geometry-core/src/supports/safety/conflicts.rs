//! Exact support-versus-model intersections (port of TS `bodyIntersection.ts`): the first
//! non-exempt hit per selected built component. `allow` must prove each intentional contact
//! locally; approving one hit never hides a later wall.

use super::index::{Bounds, CollisionIndex, triangle_of};
use super::tri::triangles_intersect;
use crate::supports::parts::tags::{Component, Part};
use std::collections::HashSet;

/// A built support mesh as the safety checks read it.
#[derive(Clone, Copy)]
pub struct SupportMesh<'a> {
    pub positions: &'a [f32],
    pub indices: &'a [u32],
    pub components: &'a [Component],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Conflict {
    pub component: usize,
    pub support_triangle: usize,
    pub model_face: usize,
}

fn triple(indices: &[u32], at: usize) -> [u32; 3] {
    [indices[at], indices[at + 1], indices[at + 2]]
}

/// Triangles of the landing tips (tip and neck components, plus the landing end of a landing
/// pillar), as the TS `tipsOf` selects them.
pub fn landing_tip_triangles(mesh: &SupportMesh) -> HashSet<[u32; 3]> {
    let mut tips = HashSet::new();
    for component in mesh.components {
        let range = component.start as usize..(component.start + component.count) as usize;
        let triangles = &mesh.indices[range];
        match (component.tag.part, component.tag.landing_reach) {
            (Part::Tip | Part::Neck, _) => tips.extend(triangles.chunks_exact(3).map(|t| [t[0], t[1], t[2]])),
            (_, Some(reach)) => tips.extend(landing_end(mesh.positions, triangles, reach)),
            _ => {}
        }
    }
    tips
}

/// Triangles of a tube within `reach` of its end (its last vertex).
fn landing_end(positions: &[f32], triangles: &[u32], reach: f64) -> Vec<[u32; 3]> {
    let last = triangles.iter().copied().max().unwrap_or(0);
    let at = |v: u32| {
        let o = v as usize * 3;
        [f64::from(positions[o]), f64::from(positions[o + 1]), f64::from(positions[o + 2])]
    };
    let end = at(last);
    let near = |v: u32| {
        let p = at(v);
        crate::supports::remesh::hypot3([p[0] - end[0], p[1] - end[1], p[2] - end[2]]) <= reach
    };
    triangles.chunks_exact(3).filter(|t| near(t[0]) && near(t[1]) && near(t[2])).map(|t| [t[0], t[1], t[2]]).collect()
}

/// `select` picks the components to test; `skip_landing_tips` exempts the marked landing tips;
/// `expired` is polled between components (a timeout ends the scan early: the caller must treat the
/// result as inconclusive, never clear).
pub fn body_conflicts(
    index: &CollisionIndex,
    supports: &SupportMesh,
    select: &dyn Fn(&Component) -> bool,
    skip_landing_tips: bool,
    allow: Option<&dyn Fn(&Conflict) -> bool>,
    expired: &dyn Fn() -> bool,
) -> Vec<Conflict> {
    if index.indices.is_empty() || supports.indices.is_empty() {
        return Vec::new();
    }
    let cell = index.cell_mm;
    let tips = if skip_landing_tips { landing_tip_triangles(supports) } else { HashSet::new() };
    let mut crossing = Vec::new();
    let mut seen = vec![0u32; index.face_count()];
    let mut stamp = 0u32;
    for (component_index, component) in supports.components.iter().enumerate() {
        if !select(component) {
            continue;
        }
        if expired() {
            break;
        }
        let mut hit = false;
        let mut at = component.start as usize;
        while at < (component.start + component.count) as usize && !hit {
            if tips.contains(&triple(supports.indices, at)) {
                at += 3;
                continue;
            }
            let support_tri = triangle_of(supports.positions, supports.indices, at / 3);
            let b = Bounds::of(&support_tri);
            stamp += 1;
            let (x0, x1) = ((b.min[0] / cell).floor() as i64, (b.max[0] / cell).floor() as i64);
            let (z0, z1) = ((b.min[2] / cell).floor() as i64, (b.max[2] / cell).floor() as i64);
            'cells: for x in x0..=x1 {
                for z in z0..=z1 {
                    for &face in index.cell(x, z) {
                        let face = face as usize;
                        if seen[face] == stamp {
                            continue;
                        }
                        seen[face] = stamp;
                        if !index.face_bounds[face].overlaps(&b) {
                            continue;
                        }
                        if triangles_intersect(&support_tri, &index.triangle(face)) {
                            let conflict = Conflict { component: component_index, support_triangle: at / 3, model_face: face };
                            if allow.is_some_and(|f| f(&conflict)) {
                                continue;
                            }
                            crossing.push(conflict);
                            hit = true;
                            break 'cells;
                        }
                    }
                }
            }
            at += 3;
        }
    }
    crossing
}
