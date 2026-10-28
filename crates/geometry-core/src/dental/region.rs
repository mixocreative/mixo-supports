//! The two-contour support region: outer ridge loop + central opening loop, the face cut they
//! make, and the narrow contact footprint on the non-fitting side. Produces data only.

use super::cache;
use super::contour::outer_contour;
use super::footprint::{Contact, Footprint, RimSide, Tuning, footprint_settings, propose_footprint};
use super::mesh::Mesh;
use crate::core::vec::dot;
use super::opening::{Opening, central_opening};
use super::orient::{Proposal, propose_orientation};
use super::profiles::AlignerProfile;
use super::topology::Context;
use std::collections::HashSet;

/// Contour edges as vertex pairs, sorted by edge key.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RegionContours {
    pub outer_edges: Vec<u32>,
    pub outer_ridge_edges: Vec<u32>,
    pub outer_connector_edges: Vec<u32>,
    pub opening_edges: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Region {
    pub contours: RegionContours,
    /// Per face: 1 on the opening-facing (fitting) side of the two contours, 0 on the other side.
    /// Supports never attach on side 1.
    pub allowed_faces: Vec<u8>,
    pub region_faces: [usize; 2],
    pub connector_lengths: [f64; 2],
    /// Narrow contact strip (set by `tune`): 1 where a contact may sit.
    pub contact_faces: Vec<u8>,
    pub contacts: Vec<Contact>,
}

/// Why detection produced no region (the oracle's reason strings).
pub type Inconclusive = String;

fn pairs(context: &Context, edges: &[usize]) -> Vec<u32> {
    edges.iter().flat_map(|&e| [context.edges[e].a, context.edges[e].b]).collect()
}

/// Splits the faces into the two regions the contours bound. `None` unless exactly two come out
/// with the expected opening-facing means and size.
fn classify_faces(context: &Context, outer: &[usize], opening: &[usize], profile: &AlignerProfile) -> Option<(Vec<u8>, [usize; 2])> {
    let t = &profile.thresholds;
    let blocked: HashSet<usize> = outer.iter().chain(opening).copied().collect();
    if blocked.len() != outer.len() + opening.len() {
        return None;
    }
    let faces = context.mesh.face_count();
    let mut parent: Vec<u32> = (0..faces as u32).collect();
    fn find(parent: &mut [u32], mut start: u32) -> u32 {
        let mut root = start;
        while parent[root as usize] != root {
            root = parent[root as usize];
        }
        while start != root {
            let next = parent[start as usize];
            parent[start as usize] = root;
            start = next;
        }
        root
    }
    for (index, edge) in context.edges.iter().enumerate() {
        if blocked.contains(&index) {
            continue;
        }
        let root = find(&mut parent, edge.faces[1]);
        let target = find(&mut parent, edge.faces[0]);
        parent[target as usize] = root;
    }
    // Regions in first-seen order: (root, faces, sum of normal . opening).
    let mut regions: Vec<(u32, usize, f64)> = Vec::new();
    for face in 0..faces as u32 {
        let root = find(&mut parent, face);
        let at = match regions.iter().position(|r| r.0 == root) {
            Some(at) => at,
            None => {
                regions.push((root, 0, 0.0));
                regions.len() - 1
            }
        };
        regions[at].1 += 1;
        regions[at].2 += dot(context.normals[face as usize], context.rim.opening_direction);
    }
    if regions.len() != 2 {
        return None;
    }
    let mean = |r: &(u32, usize, f64)| r.2 / r.1 as f64;
    let mut ranked = regions.clone();
    ranked.sort_by(|a, b| (mean(b) - mean(a)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    let (allowed, forbidden) = (ranked[0], ranked[1]);
    if mean(&allowed) < t.region_allowed_mean_min || mean(&forbidden) > t.region_forbidden_mean_max {
        return None;
    }
    let fraction = allowed.1 as f64 / faces as f64;
    if fraction < t.region_allowed_fraction_min || fraction > t.region_allowed_fraction_max {
        return None;
    }
    let mut mask = vec![0u8; faces];
    for face in 0..faces {
        if find(&mut parent, face as u32) == allowed.0 {
            mask[face] = 1;
        }
    }
    Some((mask, [allowed.1, forbidden.1]))
}

/// Detects the contours and the face cut, then tunes the strip. `Err` is the reason detection
/// found no area (never a silent empty area). The detection is kept in `cache` (same mesh bits and
/// profile), the tuning is applied on top each time.
pub fn propose_region(mesh: &Mesh, tuning: &Tuning, profile: &AlignerProfile) -> Result<Region, Inconclusive> {
    let detected = cache::detection(cache::Key::of(mesh.positions, mesh.indices, &profile.id), || detect_region(mesh, profile))?;
    retune_region(mesh, detected, tuning, profile, None)
}

/// The contours and the face cut, before any strip is tuned (a function of the mesh and the profile).
fn detect_region(mesh: &Mesh, profile: &AlignerProfile) -> Result<Region, Inconclusive> {
    let rim = match propose_orientation(mesh, profile) {
        Proposal::Proposal { rim, .. } => rim,
        Proposal::Inconclusive { reason, .. } => return Err(format!("orientation-{}", reason.code())),
    };
    let context = Context::build(mesh, &rim).ok_or("non-manifold-or-degenerate-mesh")?;
    let outer = outer_contour(&context, profile).ok_or("outer-ridge-not-closed")?;
    let opening = match central_opening(&context, profile) {
        Opening::Present(edges) => edges,
        Opening::Absent => return Err("central-opening-absent".into()),
        Opening::Ambiguous(reason) => return Err(reason.into()),
    };
    let (allowed_faces, region_faces) = classify_faces(&context, &outer.edges, &opening, profile).ok_or("surface-region-not-isolated")?;
    let mut opening_sorted = opening;
    opening_sorted.sort_by_key(|&e| context.edges[e].key);
    let region = Region {
        contours: RegionContours {
            outer_edges: pairs(&context, &outer.edges),
            outer_ridge_edges: pairs(&context, &outer.ridge_edges),
            outer_connector_edges: pairs(&context, &outer.connector_edges),
            opening_edges: pairs(&context, &opening_sorted),
        },
        allowed_faces,
        region_faces,
        connector_lengths: outer.connector_lengths,
        contact_faces: Vec::new(),
        contacts: Vec::new(),
    };
    Ok(region)
}

/// Recomputes only the narrow strip and exact contacts after operator tuning (or at another
/// sampling phase), keeping the accepted contours.
pub fn retune_region(mesh: &Mesh, region: Region, tuning: &Tuning, profile: &AlignerProfile, phase_fraction: Option<f64>) -> Result<Region, Inconclusive> {
    let mut settings = footprint_settings(tuning, profile).map_err(|reason| format!("contact-footprint-{reason}"))?;
    settings.sample_phase_fraction = phase_fraction;
    let Footprint { contact_faces, outer_contacts, inner_contacts } =
        propose_footprint(mesh, &region.allowed_faces, &region.contours.outer_edges, &region.contours.opening_edges, &settings)
            .map_err(|reason| format!("contact-footprint-{reason}"))?;
    let contacts = outer_contacts
        .into_iter()
        .map(|contact| Contact { rim: RimSide::Outer, contact })
        .chain(inner_contacts.into_iter().map(|contact| Contact { rim: RimSide::Opening, contact }))
        .collect();
    Ok(Region { contact_faces, contacts, ..region })
}
