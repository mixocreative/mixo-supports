//! Island verdict from the built-path graph. The islands are the downward-or-sideways births of the
//! model surface (a pit on an upward face has material below it and is not one); a built contact
//! within one cover radius of an island's lowest point, at or below it, links the island to what that
//! support rests on: the plate, or the lowest island of the surface it lands on. An island is
//! `resolved` only when a chain of verified links reaches the plate. Proximity alone is never a path.

use crate::supports::build::Ground;
use crate::supports::parts::model::closest_on_triangle;
use crate::supports::parts::column::ColumnContact;
use crate::core::vec::V3;
use crate::supports::safety::births::{BirthsResult, NO_BIRTH, topology_births};
use crate::supports::safety::paths::{PLATE, PathLink, PathResult, resolve_birth_paths};
use crate::core::jsnum::hypot3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IslandStatus {
    Resolved,
    Unresolved,
    /// Unresolved, and its lowest point lies on no face of the policy's permitted area: a support there
    /// is one the policy forbids, so it is left to the shape, not offered as a fix.
    OutsidePolicy,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Island {
    pub height: f64,
    pub vertex: u32,
    pub status: IslandStatus,
    /// Resolved only through a manual support.
    pub manual_only: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum IslandVerdict {
    Ok(Vec<Island>),
    /// The model or the graph cannot be judged (non-manifold surface, timeout...): no island is called resolved.
    Inconclusive(&'static str),
}

/// A vertex whose area-weighted normal points clearly upward (ny / length >= 0.3).
fn upward_vertices(positions: &[f32], indices: &[u32]) -> Vec<bool> {
    let mut sum = vec![[0.0f64; 3]; positions.len() / 3];
    let at = |v: u32| {
        let o = v as usize * 3;
        [f64::from(positions[o]), f64::from(positions[o + 1]), f64::from(positions[o + 2])]
    };
    for t in indices.chunks_exact(3) {
        let (a, b, c) = (at(t[0]), at(t[1]), at(t[2]));
        let (u, v) = ([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        for &i in t {
            for k in 0..3 {
                sum[i as usize][k] += n[k];
            }
        }
    }
    sum.iter()
        .map(|n| {
            let length = hypot3(*n);
            length > 0.0 && n[1] / length >= 0.3
        })
        .collect()
}

pub struct IslandInput<'a> {
    pub positions: &'a [f32],
    pub indices: &'a [u32],
    pub contacts: &'a [ColumnContact],
    pub grounds: &'a [Ground],
    /// Whether the contact's built support is free of body crossings.
    pub verified: &'a dyn Fn(usize) -> bool,
    /// A contact within this distance of an island's lowest point serves it (mm).
    pub cover_mm: f64,
    pub expired: &'a dyn Fn() -> bool,
    /// The policy's permitted area as a face predicate; `None` permits every face (the generic policy).
    pub permitted_face: Option<&'a dyn Fn(u32) -> bool>,
}

pub fn island_verdict(input: IslandInput) -> IslandVerdict {
    let IslandInput { positions, indices, contacts, grounds, verified, cover_mm, expired, permitted_face } = input;
    if expired() {
        return IslandVerdict::Inconclusive("timeout");
    }
    let (births, component_birth) = match topology_births(positions, indices, 1e-5) {
        BirthsResult::Ok { births, component_birth } => (births, component_birth),
        BirthsResult::Inconclusive(reason) => return IslandVerdict::Inconclusive(reason),
    };
    let upward = upward_vertices(positions, indices);
    let id = |k: usize| format!("b{k}");
    let at = |v: u32| {
        let o = v as usize * 3;
        [f64::from(positions[o]), f64::from(positions[o + 1]), f64::from(positions[o + 2])]
    };
    let nodes: Vec<(String, f64)> = births.iter().enumerate().map(|(k, b)| (id(k), b.height)).collect();
    // The faces around each island's lowest plateau: a contact on one of them serves the island.
    let mut plateau_of = vec![NO_BIRTH; positions.len() / 3];
    for (k, b) in births.iter().enumerate() {
        for &v in &b.plateau_vertices {
            plateau_of[v as usize] = k as u32;
        }
    }
    let mut star: Vec<Vec<u32>> = vec![Vec::new(); births.len()];
    for (f, tri) in indices.chunks_exact(3).enumerate() {
        let mut last = NO_BIRTH;
        for &v in tri {
            let k = plateau_of[v as usize];
            if k != NO_BIRTH && k != last {
                star[k as usize].push(f as u32);
                last = k;
            }
        }
    }
    let mut links: Vec<PathLink> = Vec::new();
    for (ci, contact) in contacts.iter().enumerate() {
        if expired() {
            return IslandVerdict::Inconclusive("timeout");
        }
        let ground = grounds.get(ci).copied().unwrap_or(Ground::None);
        let (to, bottom_y) = match ground {
            Ground::None => continue,
            Ground::Plate => (PLATE.to_string(), 0.0),
            Ground::Model { face, point, .. } => {
                let Some(face) = face.filter(|&f| (f as usize + 1) * 3 <= indices.len()) else { continue };
                // The component the landing joined at the face's highest vertex.
                let top = indices[face as usize * 3..face as usize * 3 + 3].iter().copied().max_by(|&a, &b| at(a)[1].partial_cmp(&at(b)[1]).unwrap()).unwrap();
                match component_birth[top as usize] {
                    NO_BIRTH => continue,
                    b => (id(b as usize), point[1]),
                }
            }
        };
        let p: V3 = contact.candidate.point;
        for (k, birth) in births.iter().enumerate() {
            if p[1] > birth.height + cover_mm {
                continue;
            }
            let near = star[k].iter().any(|&f| {
                let t = &indices[f as usize * 3..f as usize * 3 + 3];
                let q = closest_on_triangle(p, at(t[0]), at(t[1]), at(t[2]));
                hypot3([q[0] - p[0], q[1] - p[1], q[2] - p[2]]) <= cover_mm
            });
            if near {
                links.push(PathLink { from: id(k), to: to.clone(), top_y: p[1].min(birth.height), bottom_y, verified: verified(ci), origin: contact.candidate.origin });
            }
        }
    }
    let PathResult::Ok { resolved, manual_resolved, .. } = resolve_birth_paths(&nodes, &links) else {
        return IslandVerdict::Inconclusive("invalid support path");
    };
    let islands = births
        .iter()
        .enumerate()
        .filter(|(_, b)| b.plateau_vertices.iter().any(|&v| !upward[v as usize]))
        .map(|(k, b)| {
            let name = id(k);
            let status = if resolved.contains(&name) {
                IslandStatus::Resolved
            } else if permitted_face.is_some_and(|inside| !star[k].iter().any(|&f| inside(f))) {
                IslandStatus::OutsidePolicy
            } else {
                IslandStatus::Unresolved
            };
            Island { height: b.height, vertex: b.vertex, status, manual_only: manual_resolved.contains(&name) }
        })
        .collect();
    IslandVerdict::Ok(islands)
}
