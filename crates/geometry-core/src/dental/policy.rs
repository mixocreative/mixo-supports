//! Dental policy as data: the detected region becomes a `PolicyResult` (permitted faces, primary
//! candidates, structures with roof and cage off, repair budget). No collision, landing or repair
//! logic lives here; the shared safety engine (U7) checks every candidate.

use super::footprint::RimSide;
use super::profiles::AlignerProfile;
use super::region::Region;
use crate::supports::policy::{AllowedStructures, Candidate, CandidateId, FaceMask, Origin, PolicyResult};

/// Where the permitted area came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AreaOrigin {
    /// Both contours were detected; the area is the detected strip.
    Detected,
    /// Detection found no area and the operator painted one from scratch.
    ManualArea,
}

/// A policy together with the origin of its permitted area.
#[derive(Clone, Debug, PartialEq)]
pub struct DentalPolicy {
    pub result: PolicyResult,
    pub area_origin: AreaOrigin,
}

/// Dental allows pillars, Tree, Brace and raft; Roof and Cage stay off.
pub fn dental_structures() -> AllowedStructures {
    AllowedStructures { pillar: true, tree: true, brace: true, roof: false, cage: false, raft: true }
}

/// Candidate id for the n-th contact of a rim, stable for a given mesh and tuning.
pub fn candidate_id(rim: RimSide, index: usize) -> CandidateId {
    CandidateId(format!("dental-{}-{index}", if rim == RimSide::Outer { "outer" } else { "opening" }))
}

/// Policy of a detected region. `alternates` stay empty until U7 supplies repair options.
pub fn policy_from_region(region: &Region, profile: &AlignerProfile) -> DentalPolicy {
    let mut permitted = FaceMask::new(region.contact_faces.len());
    for (face, &flag) in region.contact_faces.iter().enumerate() {
        permitted.set(face, flag == 1);
    }
    let (mut outer, mut opening) = (0, 0);
    let candidates = region
        .contacts
        .iter()
        .map(|c| {
            let counter = if c.rim == RimSide::Outer { &mut outer } else { &mut opening };
            let id = candidate_id(c.rim, *counter);
            *counter += 1;
            Candidate { id, source_face: Some(c.contact.face), point: c.contact.position, normal: c.contact.normal, origin: Origin::Auto }
        })
        .collect();
    DentalPolicy {
        result: PolicyResult { permitted_faces: permitted, candidates, alternates: Vec::new(), structures: dental_structures(), repair_budget: profile.defaults.repair_budget },
        area_origin: AreaOrigin::Detected,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManualAreaError {
    /// Detection found an area: paint may only narrow or extend inside it, never replace it.
    DetectedAreaExists,
    /// A painted face is outside the mesh.
    FaceOutOfRange(u32),
}

/// Policy from an area the operator painted from scratch. Allowed only when detection found no
/// area (`detected` is `None`); a detected area is never overridden by paint. The contacts are not
/// chosen here and every one still goes through the shared safety checks.
pub fn manual_area_policy(face_count: usize, painted_faces: &[u32], detected: Option<&Region>, profile: &AlignerProfile) -> Result<DentalPolicy, ManualAreaError> {
    if detected.is_some() {
        return Err(ManualAreaError::DetectedAreaExists);
    }
    let mut permitted = FaceMask::new(face_count);
    for &face in painted_faces {
        if !permitted.set(face as usize, true) {
            return Err(ManualAreaError::FaceOutOfRange(face));
        }
    }
    Ok(DentalPolicy {
        result: PolicyResult { permitted_faces: permitted, candidates: Vec::new(), alternates: Vec::new(), structures: dental_structures(), repair_budget: profile.defaults.repair_budget },
        area_origin: AreaOrigin::ManualArea,
    })
}

#[cfg(test)]
mod tests {
    use super::super::profiles::reference_aligner;
    use super::*;

    fn tiny_region() -> Region {
        Region { contours: Default::default(), allowed_faces: vec![0; 4], region_faces: [0, 0], connector_lengths: [0.0; 2], contact_faces: vec![0, 1, 0, 0], contacts: Vec::new() }
    }

    #[test]
    fn detected_region_becomes_a_policy_with_roof_and_cage_off() {
        let policy = policy_from_region(&tiny_region(), reference_aligner());
        assert_eq!(policy.area_origin, AreaOrigin::Detected);
        assert!(policy.result.permitted_faces.get(1) && !policy.result.permitted_faces.get(0));
        assert!(!policy.result.structures.roof && !policy.result.structures.cage);
        assert!(policy.result.alternates.is_empty());
        assert_eq!(policy.result.repair_budget, reference_aligner().defaults.repair_budget);
    }

    #[test]
    fn a_painted_area_is_manual_area_and_only_when_nothing_was_detected() {
        let profile = reference_aligner();
        let policy = manual_area_policy(10, &[2, 3], None, profile).unwrap();
        assert_eq!(policy.area_origin, AreaOrigin::ManualArea);
        assert_eq!(policy.result.permitted_faces.count(), 2);
        assert!(policy.result.candidates.is_empty());
        assert_eq!(manual_area_policy(10, &[2], Some(&tiny_region()), profile), Err(ManualAreaError::DetectedAreaExists));
        assert_eq!(manual_area_policy(10, &[10], None, profile), Err(ManualAreaError::FaceOutOfRange(10)));
    }
}
