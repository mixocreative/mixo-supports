//! Dental policy as data: `dental_policy` turns the saved dental area of a unit into the
//! `PolicyResult` the shared engine consumes (permitted faces, primary candidates and their repair
//! alternates, contact rings, structures with roof and cage off, the profile's repair budget and
//! match tolerances, the landing rule). The saved area is recomputed on use, never grandfathered.
//! No collision, landing or repair logic lives here; the shared safety engine checks every contact.

use super::footprint::{RimSide, Tuning, footprint_settings};
use super::mesh::Mesh;
use super::cache;
use super::paint::fill_candidates;
use crate::core::vec::{V3, distance, sub};
use super::profiles::AlignerProfile;
use super::region::{Region, propose_region_facing, retune_region};
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
    /// Every suggested tip the host could offer (B3): those that pass the strip, belt and manual-tip
    /// skips, whether painted or not, in the policy's frame. Add snaps to the nearest of these and the
    /// shown candidates; they are never contacts themselves.
    pub suggestions: Vec<Candidate>,
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
    /// The unit's manual tips (unit-local): a suggested tip within the profile's tip separation of
    /// one is not offered.
    pub keep_clear_of: &'a [[f64; 3]],
}

/// Dental allows pillars and raft, Tree and Brace by the operator's switches; Roof and Cage stay off.
pub fn dental_structures(structure: DentalStructure) -> AllowedStructures {
    AllowedStructures { pillar: true, tree: structure.tree, brace: structure.brace, roof: false, cage: false, raft: true }
}

/// Candidate id for the n-th contact of a rim, stable for a given mesh and tuning.
pub fn candidate_id(rim: RimSide, index: usize) -> CandidateId {
    CandidateId(format!("dental-{}-{index}", rim_name(rim)))
}

/// Candidate id of the K-th suggested tip (`paint::fill_candidates`), stable for a given mesh, plate
/// normal and density.
pub fn fill_id(index: usize) -> CandidateId {
    CandidateId(format!("dental-fill-{index}"))
}

/// Id of the n-th half-step sample of a rim, offered as a repair alternate.
pub fn alternate_id(rim: RimSide, index: usize) -> CandidateId {
    CandidateId(format!("dental-{}-alt-{index}", rim_name(rim)))
}

fn rim_name(rim: RimSide) -> &'static str {
    if rim == RimSide::Outer { "outer" } else { "opening" }
}

/// Exact face gate of a contour (belt) contact: it may stand on a strip face unless a later area edit
/// reaching it says otherwise (add paint may restore an erased spot); unpainted is allowed. Paint
/// outside the strip reveals suggested tips (`paint::fill_candidates`), not contour contacts.
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

/// The plate normal (+Y of `frame`) in the unit-local frame: tips must be reachable from below it.
fn plate_up(frame: &Matrix4) -> V3 {
    [frame[1], frame[5], frame[9]]
}

/// Gate of a contour contact: on the strip as [`area_allows`]; off the strip it was moved there to
/// be reachable from below (`sampling::FromBelow`, the only way a contour contact leaves the
/// strip), and an erase stamp reaching it still takes it out.
fn contour_allows(contact_faces: &[u8], stamps: &[AreaStamp], c: &super::sampling::ContourContact) -> bool {
    match contact_faces.get(c.face as usize) {
        Some(1) => area_allows(contact_faces, stamps, c.face, c.position, c.normal),
        Some(_) => AreaStamp::resolve(stamps, c.position, Some(c.normal)).unwrap_or(true),
        None => false,
    }
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
    let finish = |result, area_origin, reproduced| DentalPolicy { result, area_origin, profile_id: profile.id.clone(), reproduced, suggestions: Vec::new() };
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
            let Some(region) = reproduce(mesh, tuning, saved, profile, plate_up(frame)) else { return finish(closed, AreaOrigin::Detected, false) };
            // The area is the strip plus every painted face plus the faces tips moved to so a
            // support reaches them from below; erase stamps take faces back out through the
            // landing rule and the candidate gate.
            let painted = faces_painted_by_stamps(mesh, stamps);
            let (candidates, alternates, rings, suggestions) = contacts_of(input, &region, tuning);
            let mut permitted = mask_of(region.contact_faces.iter().map(|&f| f == 1), faces);
            let moved = candidates.iter().chain(alternates.iter().flat_map(|(_, list)| list)).filter(|c| c.origin == Origin::Auto).filter_map(|c| c.source_face);
            for face in painted.iter().copied().chain(moved) {
                permitted.set(face as usize, true);
            }
            let result = PolicyResult {
                permitted_faces: permitted,
                candidates,
                alternates,
                rings,
                ..closed
            };
            DentalPolicy { suggestions, ..finish(result, AreaOrigin::Detected, true) }
        }
    }
}

/// The region detection gives now, only when it is exactly the saved one (its contacts placed for
/// plate normal `up`, which does not change the masks).
fn reproduce(mesh: &Mesh, tuning: &Tuning, saved: &SavedRegion, profile: &AlignerProfile, up: V3) -> Option<Region> {
    let region = propose_region_facing(mesh, tuning, profile, Some(up)).ok()?;
    let same = region.allowed_faces == saved.allowed_faces
        && region.contact_faces == saved.contact_faces
        && region.contours.outer_edges == saved.outer_edges
        && region.contours.opening_edges == saved.opening_edges;
    same.then_some(region)
}

type Alternates = Vec<(CandidateId, Vec<Candidate>)>;

/// Gated belt candidates (in the output frame) then the suggested tips the paint reveals, the belt
/// candidates' half-step repair alternates and the two contact rings.
fn contacts_of(input: &DentalPolicyInput, region: &Region, tuning: &Tuning) -> (Vec<Candidate>, Alternates, Vec<Ring>, Vec<Candidate>) {
    let DentalPolicyInput { mesh, profile, stamps, frame, keep_clear_of, .. } = input;
    let gate = |c: &super::sampling::ContourContact| contour_allows(&region.contact_faces, stamps, c);
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
    // Half-step samples sit halfway between primaries; each is offered to the primary that follows
    // it on its rim (within one spacing), so no two contacts can move to one spot.
    let (outer_length, opening_length) = (contour_length(mesh, &region.contours.outer_edges), contour_length(mesh, &region.contours.opening_edges));
    let settings = footprint_settings(tuning, profile).ok();
    let half_step = retune_region(mesh, region.clone(), tuning, profile, Some(0.5), Some(plate_up(frame))).map(|r| r.contacts).unwrap_or_default();
    let mut alternates: Alternates = Vec::new();
    let mut alternate_arcs: Vec<(RimSide, CandidateId, f64)> = Vec::new();
    let mut alt_counters = [0usize; 2];
    for c in &half_step {
        let counter = &mut alt_counters[usize::from(c.rim == RimSide::Opening)];
        let id = alternate_id(c.rim, *counter);
        *counter += 1;
        let spacing = settings.map_or(0.0, |s| if c.rim == RimSide::Outer { s.outer_spacing } else { s.inner_spacing });
        if !gate(&c.contact) {
            continue;
        }
        let arc = c.contact.distance_along_contour;
        // Arc to a primary, forward along the rim; the one after the last primary wraps to the first (D19).
        let perimeter = if c.rim == RimSide::Outer { outer_length } else { opening_length };
        let ahead = |at: f64| if at >= arc { at - arc } else { at + perimeter - arc };
        let owner = primaries.iter().filter(|(rim, _, at)| *rim == c.rim && ahead(*at) <= spacing).min_by(|a, b| ahead(a.2).total_cmp(&ahead(b.2)));
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
            // Each rim's spacing is its actual even step (D19), so one missing tip is exactly a 2-step gap.
            let ring = |rim: RimSide, edges: &[u32], spacing: f64| Ring {
                perimeter_mm: contour_length(mesh, edges),
                spacing_mm: super::sampling::even_step(contour_length(mesh, edges), spacing),
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
    // Suggested tips over every face reached from below at the outer spacing (cached per mesh, plate
    // normal and density, so K is stable); this run offers those off the strip, clear of the belt
    // and of manual tips, that the paint explicitly reveals. Ids are kept, gaps allowed.
    let up = plate_up(frame);
    let fills = settings
        .map(|s| {
            let key = cache::FillKey::of(mesh.positions, mesh.indices, &profile.id, up, tuning.density);
            cache::fills(key, || fill_candidates(mesh, up, s.outer_spacing, profile.defaults.tip_min_from_up_deg))
        })
        .unwrap_or_default();
    let skip = FillSkip { contact_faces: &region.contact_faces, belt: &kept, belt_clear: settings.map_or(0.0, |s| s.outer_spacing / 2.0), manual: keep_clear_of, manual_clear: profile.defaults.min_tip_separation_mm, stamps };
    let filled: Vec<Candidate> = offered_fills(&fills, &skip, true).map(|at| candidate(fill_id(at), &fills[at])).collect();
    let suggestions: Vec<Candidate> = offered_fills(&fills, &skip, false).map(|at| candidate(fill_id(at), &fills[at])).collect();
    (primaries.into_iter().map(|(_, c, _)| c).chain(filled).collect(), alternates, rings, suggestions)
}

/// What decides, per policy run, which suggested tips are offered (B2).
struct FillSkip<'a> {
    contact_faces: &'a [u8],
    /// The kept belt tips and how near (3D mm) a suggested tip may not be to one.
    belt: &'a [V3],
    belt_clear: f64,
    /// The unit's manual tips and how near a suggested tip may not be to one.
    manual: &'a [[f64; 3]],
    manual_clear: f64,
    stamps: &'a [AreaStamp],
}

/// Indices (K) of the suggested tips offered: not (a) on a strip face, (b) within `belt_clear` of a
/// kept belt tip, (c) within `manual_clear` of a manual tip, and (d) explicitly painted (unpainted is
/// not offered; `painted_only` false drops that last rule, for the tips Add can snap to).
fn offered_fills<'a>(fills: &'a [super::sampling::ContourContact], skip: &'a FillSkip, painted_only: bool) -> impl Iterator<Item = usize> + 'a {
    fills.iter().enumerate().filter(move |(_, c)| {
        skip.contact_faces.get(c.face as usize) != Some(&1)
            && !skip.belt.iter().any(|&at| distance(at, c.position) < skip.belt_clear)
            && !skip.manual.iter().any(|&at| distance(at, c.position) < skip.manual_clear)
            && (!painted_only || AreaStamp::resolve(skip.stamps, c.position, Some(c.normal)) == Some(true))
    }).map(|(at, _)| at)
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
