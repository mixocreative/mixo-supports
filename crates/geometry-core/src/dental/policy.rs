//! Dental policy as data: the detected region becomes a `PolicyResult` (permitted faces, primary
//! candidates, structures with roof and cage off, repair budget). No collision, landing or repair
//! logic lives here; the shared safety engine (U7) checks every candidate.

use super::footprint::RimSide;
use super::mesh::{Mesh, add, cross, dot, normalize, scale, sub};
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

/// One brush dab: a sphere on the surface, the surface normal it was painted on, and whether it
/// adds (`allow`) or removes the area. Stamps apply in order; the last one that reaches a face wins.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stamp {
    pub center: [f64; 3],
    pub radius: f64,
    pub normal: [f64; 3],
    pub allow: bool,
}

/// Faces an ordered stroke list paints: a stamp reaches a face when its centroid is inside the
/// sphere and the face normal points the same way as the stamp normal (a thin wall never paints
/// its far side).
pub fn faces_painted_by_stamps(mesh: &Mesh, stamps: &[Stamp]) -> Vec<u32> {
    let mut painted = Vec::new();
    for face in 0..mesh.face_count() {
        let [a, b, c] = mesh.face_points(face);
        let centroid = scale(add(add(add([0.0; 3], a), b), c), 1.0 / 3.0);
        let normal = normalize(cross(sub(b, a), sub(c, a)));
        let verdict = stamps.iter().rev().find(|stamp| {
            let d = sub(centroid, stamp.center);
            dot(d, d) <= stamp.radius * stamp.radius && dot(normal, stamp.normal) > 0.0
        });
        if verdict.is_some_and(|stamp| stamp.allow) {
            painted.push(face as u32);
        }
    }
    painted
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

    #[test]
    fn stamps_paint_faces_in_order_and_ignore_the_far_side() {
        // Two facing-up triangles and one facing down, all near the origin.
        let positions: [f32; 27] = [0., 0., 0., 1., 0., 0., 0., 0., 1., 2., 0., 0., 3., 0., 0., 2., 0., 1., 0., 5., 0., 0., 5., 1., 1., 5., 0.];
        let indices: [u32; 9] = [0, 2, 1, 3, 5, 4, 6, 7, 8];
        let mesh = Mesh::new(&positions, &indices);
        let up = Stamp { center: [0.3, 0.0, 0.3], radius: 5.0, normal: [0.0, 1.0, 0.0], allow: true };
        let painted = faces_painted_by_stamps(&mesh, &[up]);
        assert_eq!(painted, vec![0, 1]);
        let erase = Stamp { center: [0.3, 0.0, 0.3], radius: 0.6, normal: [0.0, 1.0, 0.0], allow: false };
        assert_eq!(faces_painted_by_stamps(&mesh, &[up, erase]), vec![1]);
    }
}

