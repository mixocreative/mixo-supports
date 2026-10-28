//! Dental policy as data: `dental_policy` turns the saved dental area of a unit into the
//! `PolicyResult` the shared engine consumes (permitted faces, primary candidates and their repair
//! alternates, contact rings, structures with roof and cage off, the profile's repair budget and
//! match tolerances, the landing rule). The saved area is recomputed on use, never grandfathered.
//! No collision, landing or repair logic lives here; the shared safety engine checks every contact.

use super::footprint::{RimSide, Tuning, footprint_settings};
use super::mesh::Mesh;
use super::paint::{PaintFill, paint_contacts};
use crate::core::vec::{V3, distance, sub};
use super::profiles::AlignerProfile;
use super::region::{Region, propose_region, retune_region};
use crate::core::matrix::{Matrix4, apply_to_direction, apply_to_point};
use crate::supports::policy::{AllowedStructures, AreaStamp, AutomaticRule, Candidate, CandidateId, FaceMask, LandingRule, Origin, PolicyResult, Ring, StructureChoice};
use crate::core::jsnum::hypot3;

/// Where the permitted area came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AreaOrigin {
    /// Both contours were detected; the area is the detected strip.
    Detected,
    /// Detection found no area and the operator painted one from scratch.
    ManualArea,
    /// An older saved policy without a two-contour area: it permits no automatic support.
    Legacy,
}

/// The dental-only structure switches (Step 3). Roof and Cage are never allowed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DentalStructure {
    pub tree: bool,
    pub brace: bool,
}

/// A policy together with the origin of its area and the profile it was made with.
#[derive(Clone, Debug, PartialEq)]
pub struct DentalPolicy {
    pub result: PolicyResult,
    pub area_origin: AreaOrigin,
    pub profile_id: String,
    /// False when a saved two-contour area could not be reproduced from this mesh: the policy then
    /// has no candidates and no permitted face, so no automatic support is built.
    pub reproduced: bool,
}

/// The two-contour area as it was saved, compared with what detection gives now.
pub struct SavedRegion<'a> {
    pub allowed_faces: &'a [u8],
    pub contact_faces: &'a [u8],
    pub outer_edges: &'a [u32],
    pub opening_edges: &'a [u32],
}

/// What the unit's saved dental policy says the area is.
pub enum DentalArea<'a> {
    TwoContour { tuning: Tuning, saved: SavedRegion<'a> },
    /// Painted from scratch because detection found no area: the paint is the area.
    ManualArea,
    Legacy,
}

pub struct DentalPolicyInput<'a> {
    /// The unit-local source mesh.
    pub mesh: &'a Mesh<'a>,
    pub profile: &'a AlignerProfile,
    pub area: DentalArea<'a>,
    /// The operator's area edits, unit-local, in stroke order.
    pub stamps: &'a [AreaStamp],
    pub structure: DentalStructure,
    /// Unit-local to the frame the result is in (plate space for `generate`).
    pub frame: &'a Matrix4,
}

/// Dental allows pillars and raft, Tree and Brace by the operator's switches; Roof and Cage stay off.
pub fn dental_structures(structure: DentalStructure) -> AllowedStructures {
    AllowedStructures { pillar: true, tree: structure.tree, brace: structure.brace, roof: false, cage: false, raft: true }
}

/// Candidate id for the n-th contact of a rim, stable for a given mesh and tuning.
pub fn candidate_id(rim: RimSide, index: usize) -> CandidateId {
    CandidateId(format!("dental-{}-{index}", rim_name(rim)))
}

/// Candidate id for the n-th contact the paint fill added outside the strip.
pub fn paint_id(index: usize) -> CandidateId {
    CandidateId(format!("dental-paint-{index}"))
}

/// Id of the n-th phase-zero sample of a rim, offered as a repair alternate.
pub fn alternate_id(rim: RimSide, index: usize) -> CandidateId {
    CandidateId(format!("dental-{}-alt-{index}", rim_name(rim)))
}

fn rim_name(rim: RimSide) -> &'static str {
    if rim == RimSide::Outer { "outer" } else { "opening" }
}

/// Exact face gate of a contour contact: it may stand on a strip face unless a later area edit
/// reaching it says otherwise (add paint may restore an erased spot). Paint outside the strip is
/// filled by its own contacts (`paint::paint_contacts`), not by moving contour contacts there.
pub fn area_allows(contact_faces: &[u8], stamps: &[AreaStamp], face: u32, point: [f64; 3], normal: [f64; 3]) -> bool {
    if contact_faces.get(face as usize) != Some(&1) {
        return false;
    }
    AreaStamp::resolve(stamps, point, Some(normal)).unwrap_or(true)
}

fn mask_of(flags: impl Iterator<Item = bool>, len: usize) -> FaceMask {
    let mut mask = FaceMask::new(len);
    for (face, flag) in flags.enumerate() {
        mask.set(face, flag);
    }
    mask
}

fn through(frame: &Matrix4, point: [f64; 3], normal: [f64; 3]) -> ([f64; 3], [f64; 3]) {
    (apply_to_point(frame, point[0], point[1], point[2]), apply_to_direction(frame, normal[0], normal[1], normal[2]))
}

/// Length of a contour given as vertex pairs (the ring perimeter).
pub fn contour_length(mesh: &Mesh, edges: &[u32]) -> f64 {
    edges.chunks_exact(2).fold(0.0, |sum, e| sum + hypot3(sub(mesh.point(e[0]), mesh.point(e[1]))))
}

/// The policy of a unit's dental area. Never fails: an area that cannot be reproduced (or an older
/// saved policy) permits nothing automatic.
pub fn dental_policy(input: &DentalPolicyInput) -> DentalPolicy {
    let DentalPolicyInput { mesh, profile, stamps, structure, frame, .. } = input;
    let faces = mesh.face_count();
    let d = &profile.defaults;
    let matching = AutomaticRule::MatchCandidates { tol_mm: d.match_tolerance_mm, min_dot: d.match_min_dot };
    let framed_stamps: Vec<AreaStamp> = stamps
        .iter()
        .map(|s| {
            let (center, normal) = through(frame, s.center, s.normal);
            AreaStamp { center, normal, ..*s }
        })
        .collect();
    // The switches decide Tree and Brace (whatever the generic settings say); Roof and Cage stay off.
    let choice = Some(StructureChoice { tree: structure.tree, brace: structure.brace });
    let base = PolicyResult { structure_choice: choice, ..PolicyResult::plain(FaceMask::new(faces), Vec::new(), dental_structures(*structure), d.repair_budget) };
    let finish = |result, area_origin, reproduced| DentalPolicy { result, area_origin, profile_id: profile.id.clone(), reproduced };
    match &input.area {
        DentalArea::Legacy => finish(PolicyResult { automatic: matching, ..base }, AreaOrigin::Legacy, true),
        DentalArea::ManualArea => {
            // The painted faces are the area; the contacts the host passes were filled inside it
            // (`legacy::fill_legacy_dental`), so they are permitted as given. Secondary landings
            // stay on the painted faces and every contact still passes the safety checks.
            let painted = faces_painted_by_stamps(mesh, stamps);
            let mut permitted = FaceMask::new(faces);
            for face in painted {
                permitted.set(face as usize, true);
            }
            let result = PolicyResult {
                permitted_faces: permitted,
                landing_rule: LandingRule::ApprovedFaces { stamps: framed_stamps },
                islands_outside_permitted: true,
                ..base
            };
            finish(result, AreaOrigin::ManualArea, true)
        }
        DentalArea::TwoContour { tuning, saved } => {
            let closed = PolicyResult {
                automatic: matching,
                landing_rule: LandingRule::ApprovedFaces { stamps: framed_stamps.clone() },
                islands_outside_permitted: true,
                ..base.clone()
            };
            let Some(region) = reproduce(mesh, tuning, saved, profile) else { return finish(closed, AreaOrigin::Detected, false) };
            // The area is the strip plus every painted face; erase stamps take faces back out
            // through the landing rule and the candidate gate.
            let painted = faces_painted_by_stamps(mesh, stamps);
            let (candidates, alternates, rings) = contacts_of(input, &region, tuning, &painted);
            let mut permitted = mask_of(region.contact_faces.iter().map(|&f| f == 1), faces);
            for &face in &painted {
                permitted.set(face as usize, true);
            }
            let result = PolicyResult {
                permitted_faces: permitted,
                candidates,
                alternates,
                rings,
                ..closed
            };
            finish(result, AreaOrigin::Detected, true)
        }
    }
}

/// The region detection gives now, only when it is exactly the saved one.
fn reproduce(mesh: &Mesh, tuning: &Tuning, saved: &SavedRegion, profile: &AlignerProfile) -> Option<Region> {
    let region = propose_region(mesh, tuning, profile).ok()?;
    let same = region.allowed_faces == saved.allowed_faces
        && region.contact_faces == saved.contact_faces
        && region.contours.outer_edges == saved.outer_edges
        && region.contours.opening_edges == saved.opening_edges;
    same.then_some(region)
}

type Alternates = Vec<(CandidateId, Vec<Candidate>)>;

/// Gated primary candidates (in the output frame) then the paint fill's, the contour candidates'
/// phase-zero repair alternates and the two contact rings.
fn contacts_of(input: &DentalPolicyInput, region: &Region, tuning: &Tuning, painted: &[u32]) -> (Vec<Candidate>, Alternates, Vec<Ring>) {
    let DentalPolicyInput { mesh, profile, stamps, frame, .. } = input;
    let gate = |c: &super::sampling::ContourContact| area_allows(&region.contact_faces, stamps, c.face, c.position, c.normal);
    let candidate = |id: CandidateId, c: &super::sampling::ContourContact| {
        let (point, normal) = through(frame, c.position, c.normal);
        Candidate { id, source_face: Some(c.face), point, normal, origin: Origin::Auto }
    };
    // (rim, id, arc) of every gated primary, in region order (outer rim first).
    let mut primaries: Vec<(RimSide, Candidate, f64)> = Vec::new();
    let mut kept: Vec<V3> = Vec::new();
    let mut counters = [0usize; 2];
    for c in &region.contacts {
        let counter = &mut counters[usize::from(c.rim == RimSide::Opening)];
        let id = candidate_id(c.rim, *counter);
        *counter += 1;
        if gate(&c.contact) {
            kept.push(c.contact.position);
            primaries.push((c.rim, candidate(id, &c.contact), c.contact.distance_along_contour));
        }
    }
    // Phase-zero samples sit half a spacing before each primary; each is offered to the primary
    // that follows it on its rim (within one spacing), so no two contacts can move to one spot.
    let settings = footprint_settings(tuning, profile).ok();
    let phase_zero = retune_region(mesh, region.clone(), tuning, profile, Some(0.0)).map(|r| r.contacts).unwrap_or_default();
    let mut alternates: Alternates = Vec::new();
    let mut alternate_arcs: Vec<(RimSide, CandidateId, f64)> = Vec::new();
    let mut alt_counters = [0usize; 2];
    for c in &phase_zero {
        let counter = &mut alt_counters[usize::from(c.rim == RimSide::Opening)];
        let id = alternate_id(c.rim, *counter);
        *counter += 1;
        let spacing = settings.map_or(0.0, |s| if c.rim == RimSide::Outer { s.outer_spacing } else { s.inner_spacing });
        if !gate(&c.contact) {
            continue;
        }
        let arc = c.contact.distance_along_contour;
        let owner = primaries.iter().filter(|(rim, _, at)| *rim == c.rim && *at >= arc && *at - arc <= spacing).min_by(|a, b| a.2.total_cmp(&b.2));
        let Some((_, owner, _)) = owner else { continue };
        // A spot within the tip separation of a primary (its owner included) is no real alternative:
        // on the middle line two samples can meet on one face where the band is narrow.
        if kept.iter().any(|&at| distance(at, c.contact.position) < profile.defaults.min_tip_separation_mm) {
            continue;
        }
        alternate_arcs.push((c.rim, id.clone(), arc));
        let option = candidate(id, &c.contact);
        match alternates.iter_mut().find(|(o, _)| *o == owner.id) {
            Some((_, list)) => list.push(option),
            None => alternates.push((owner.id.clone(), vec![option])),
        }
    }
    let rings = settings
        .map(|s| {
            let ring = |rim: RimSide, edges: &[u32], spacing_mm: f64| Ring {
                perimeter_mm: contour_length(mesh, edges),
                spacing_mm,
                arcs: primaries
                    .iter()
                    .filter(|(r, ..)| *r == rim)
                    .map(|(_, c, arc)| (c.id.clone(), *arc))
                    .chain(alternate_arcs.iter().filter(|(r, ..)| *r == rim).map(|(_, id, arc)| (id.clone(), *arc)))
                    .collect(),
            };
            vec![ring(RimSide::Outer, &region.contours.outer_edges, s.outer_spacing), ring(RimSide::Opening, &region.contours.opening_edges, s.inner_spacing)]
        })
        .unwrap_or_default();
    // Painted faces outside the strip get their own contacts at the outer spacing, clear of the
    // contour contacts kept above.
    let fill = settings.map(|s| PaintFill { mesh, stamps, painted, skip: &region.contact_faces, frame, spacing: s.outer_spacing, keep_clear_of: &kept });
    let filled = fill.map(|f| paint_contacts(&f)).unwrap_or_default();
    let filled = filled.iter().enumerate().map(|(at, c)| candidate(paint_id(at), c));
    (primaries.into_iter().map(|(_, c, _)| c).chain(filled).collect(), alternates, rings)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManualAreaError {
    /// Detection found an area: paint may only narrow or extend inside it, never replace it.
    DetectedAreaExists,
    /// A painted face is outside the mesh.
    FaceOutOfRange(u32),
}

/// The permitted faces of an area painted from scratch. Allowed only when detection found no area
/// (`detected` false); a detected area is never overridden by paint.
pub fn manual_area_faces(face_count: usize, painted_faces: &[u32], detected: bool) -> Result<FaceMask, ManualAreaError> {
    if detected {
        return Err(ManualAreaError::DetectedAreaExists);
    }
    let mut permitted = FaceMask::new(face_count);
    for &face in painted_faces {
        if !permitted.set(face as usize, true) {
            return Err(ManualAreaError::FaceOutOfRange(face));
        }
    }
    Ok(permitted)
}

/// One brush dab (shared with the engine's landing rule); see `AreaStamp`.
pub type Stamp = AreaStamp;

pub use super::paint::faces_painted_by_stamps;

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
