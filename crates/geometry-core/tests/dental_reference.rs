//! U6a done checks on the canonical fixture (docs/dental-reference/reference-aligner.stl).

use mixo_geometry_core::core::stl::BinaryStlStream;
use mixo_geometry_core::core::vec::distance;
use mixo_geometry_core::dental::mesh::Mesh;
use mixo_geometry_core::dental::footprint::Tuning;
use mixo_geometry_core::dental::orientation::{OpeningState, Orientation, orient_dental};
use mixo_geometry_core::core::matrix::placement_matrix;
use mixo_geometry_core::dental::policy::{AreaOrigin, DentalArea, DentalPolicyInput, DentalStructure, SavedRegion, dental_policy};
use mixo_geometry_core::dental::profiles::{AlignerProfile, parse, reference_aligner};
use mixo_geometry_core::supports::policy::{AreaStamp, AutomaticRule, LandingRule};
use mixo_geometry_core::dental::region::propose_region;

fn reference() -> (Vec<f32>, Vec<u32>) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/dental-reference/reference-aligner.stl");
    let bytes = std::fs::read(path).expect("reference aligner");
    let triangles = u32::from_le_bytes(bytes[80..84].try_into().unwrap());
    let mut stream = BinaryStlStream::new(triangles).unwrap();
    stream.push(&bytes).unwrap();
    let mesh = stream.finish().unwrap();
    (mesh.positions, mesh.indices)
}

#[test]
fn reference_region_matches_the_pinned_counts() {
    let (positions, indices) = reference();
    let mesh = Mesh::new(&positions, &indices);
    let profile = reference_aligner();
    let start = std::time::Instant::now();
    let region = propose_region(&mesh, &Tuning::defaults(profile), profile).expect("region");
    eprintln!("propose_region: {:?}", start.elapsed());
    assert_eq!(region.contours.outer_edges.len() / 2, 2665);
    assert_eq!(region.contours.opening_edges.len() / 2, 339);
    assert_eq!(region.region_faces, [254344, 119612]);
    assert_eq!(region.allowed_faces.iter().map(|&f| usize::from(f)).sum::<usize>(), 254344);
    assert!(region.contacts.len() > 70 && region.contacts.len() < 130, "{}", region.contacts.len());
    let separation = profile.defaults.min_tip_separation_mm;
    for (at, a) in region.contacts.iter().enumerate() {
        for b in &region.contacts[at + 1..] {
            assert!(distance(a.contact.position, b.contact.position) >= separation, "two tips closer than {separation} mm");
        }
    }
}

fn policy_of(mesh: &Mesh, profile: &AlignerProfile, stamps: &[AreaStamp], frame: [f64; 3]) -> (mixo_geometry_core::dental::region::Region, mixo_geometry_core::dental::policy::DentalPolicy) {
    let tuning = Tuning::defaults(profile);
    let region = propose_region(mesh, &tuning, profile).expect("region");
    let saved = SavedRegion { allowed_faces: &region.allowed_faces, contact_faces: &region.contact_faces, outer_edges: &region.contours.outer_edges, opening_edges: &region.contours.opening_edges };
    let frame = placement_matrix(frame, [0.0; 3]);
    let input = DentalPolicyInput { mesh, profile, area: DentalArea::TwoContour { tuning, saved }, stamps, structure: DentalStructure { tree: true, brace: false }, frame: &frame };
    let policy = dental_policy(&input);
    (region, policy)
}

/// `dental_policy` on the reference: the whole PolicyResult is made in Rust from the saved area.
#[test]
fn reference_policy_is_built_in_rust() {
    let (positions, indices) = reference();
    let mesh = Mesh::new(&positions, &indices);
    let profile = reference_aligner();
    let start = std::time::Instant::now();
    let (region, policy) = policy_of(&mesh, profile, &[], [0.0, 7.0, 0.0]);
    eprintln!("propose_region + dental_policy: {:?}", start.elapsed());
    assert!(policy.reproduced);
    assert_eq!(policy.area_origin, AreaOrigin::Detected);
    assert_eq!(policy.profile_id, "reference-aligner");
    let r = &policy.result;
    assert_eq!(r.candidates.len(), region.contacts.len());
    assert!(r.candidates.iter().all(|c| r.permitted_faces.get(c.source_face.unwrap() as usize)));
    assert!(r.candidates.iter().any(|c| c.id.0 == "dental-outer-0") && r.candidates.iter().any(|c| c.id.0 == "dental-opening-0"));
    // Candidates are in the output frame (lifted by 7 mm), the strip is the permitted area.
    assert!((r.candidates[0].point[1] - region.contacts[0].contact.position[1] - 7.0).abs() < 1e-9);
    assert_eq!(r.permitted_faces.count(), region.contact_faces.iter().filter(|&&f| f == 1).count());
    assert_eq!(r.automatic, AutomaticRule::MatchCandidates { tol_mm: 0.03, min_dot: 0.95 });
    assert!(matches!(r.landing_rule, LandingRule::ApprovedFaces { .. }) && r.islands_outside_permitted);
    assert_eq!(r.repair_budget, profile.defaults.repair_budget);
    assert!(r.structures.tree && !r.structures.brace && !r.structures.roof && !r.structures.cage);
    // Repair alternates: phase-zero samples, each owned by one primary, none a primary itself.
    assert!(!r.alternates.is_empty());
    let mut seen = std::collections::HashSet::new();
    for (owner, options) in &r.alternates {
        assert!(r.candidates.iter().any(|c| &c.id == owner));
        for option in options {
            assert!(option.id.0.contains("-alt-") && seen.insert(option.id.clone()));
            assert!(r.permitted_faces.get(option.source_face.unwrap() as usize));
        }
    }
    // Two rings whose arcs cover the primaries and the alternates.
    assert_eq!(r.rings.len(), 2);
    assert!(r.rings[0].perimeter_mm > 0.0 && r.rings[1].perimeter_mm > 0.0);
    assert_eq!(r.rings.iter().map(|ring| ring.arcs.len()).sum::<usize>(), r.candidates.len() + seen.len());
}

#[test]
fn reference_policy_honours_erase_paint_and_a_changed_area() {
    let (positions, indices) = reference();
    let mesh = Mesh::new(&positions, &indices);
    let profile = reference_aligner();
    let (region, _) = policy_of(&mesh, profile, &[], [0.0; 3]);
    let first = region.contacts[0].contact;
    let erase = AreaStamp { center: first.position, radius: 0.5, normal: first.normal, allow: false };
    let (_, erased) = policy_of(&mesh, profile, &[erase], [0.0; 3]);
    assert_eq!(erased.result.candidates.len(), region.contacts.len() - 1);
    assert!(erased.result.candidates.iter().all(|c| c.id.0 != "dental-outer-0"), "erased ids are not renumbered away");
    // A saved strip that differs from what detection gives now is never trusted.
    let mut strip = region.contact_faces.clone();
    let on = strip.iter().position(|&f| f == 1).unwrap();
    strip[on] = 0;
    let saved = SavedRegion { allowed_faces: &region.allowed_faces, contact_faces: &strip, outer_edges: &region.contours.outer_edges, opening_edges: &region.contours.opening_edges };
    let frame = placement_matrix([0.0; 3], [0.0; 3]);
    let input = DentalPolicyInput { mesh: &mesh, profile, area: DentalArea::TwoContour { tuning: Tuning::defaults(profile), saved }, stamps: &[], structure: DentalStructure { tree: true, brace: true }, frame: &frame };
    let changed = dental_policy(&input);
    assert!(!changed.reproduced && changed.result.candidates.is_empty() && changed.result.permitted_faces.count() == 0);
}

/// A second profile is only a JSON file: it reaches detection (spacing), defaults and the budget.
#[test]
fn a_second_profile_file_reaches_detection_defaults_and_budget() {
    let second = parse(include_str!("../src/dental/profiles/testdata/second-aligner.json")).expect("fixture");
    assert_eq!(second.id, "test-second-aligner");
    let (positions, indices) = reference();
    let mesh = Mesh::new(&positions, &indices);
    let (_, reference_policy) = policy_of(&mesh, reference_aligner(), &[], [0.0; 3]);
    let (region, policy) = policy_of(&mesh, &second, &[], [0.0; 3]);
    assert_eq!(policy.profile_id, "test-second-aligner");
    assert_eq!(policy.result.repair_budget, 3);
    assert_eq!(policy.result.automatic, AutomaticRule::MatchCandidates { tol_mm: 0.05, min_dot: 0.95 });
    assert_eq!(policy.result.rings[0].spacing_mm, 4.5);
    assert!(policy.result.candidates.len() < reference_policy.result.candidates.len(), "wider default spacing, fewer contacts");
    assert_eq!(Tuning::defaults(&second).setback_mm, 0.3);
    assert_eq!(policy.result.candidates.len(), region.contacts.len());
}

#[test]
fn reference_orients_with_a_present_opening() {
    let (positions, indices) = reference();
    let mesh = Mesh::new(&positions, &indices);
    let rotation_with = |profile: &AlignerProfile| match orient_dental(&mesh, profile) {
        Orientation::Oriented { opening, mesh_ok, rotation, .. } => {
            assert_eq!(opening, OpeningState::Present);
            assert!(mesh_ok);
            rotation.expect("an arch front")
        }
        Orientation::Failed { reason, .. } => panic!("failed: {reason:?}"),
    };
    // The reference scan is already in the approved pose: its rotation is (numerically) none.
    let reference = rotation_with(reference_aligner());
    assert!(reference.iter().all(|r| r.abs() < 1e-9), "{reference:?}");
    // Another aligner type sets its own tilt: 20 degrees less tilt turns the part 20 degrees.
    let mut flatter = reference_aligner().clone();
    flatter.pose.tilt_deg -= 20.0;
    let turned = rotation_with(&flatter);
    let angle = (turned.iter().map(|r| r * r).sum::<f64>()).sqrt().to_degrees();
    assert!((angle - 20.0).abs() < 0.5, "{turned:?}");
}

#[test]
fn a_cube_abstains_and_a_malformed_mesh_fails() {
    let positions: [f32; 24] = [-1., -1., -1., 1., -1., -1., 1., 1., -1., -1., 1., -1., -1., -1., 1., 1., -1., 1., 1., 1., 1., -1., 1., 1.];
    let indices: [u32; 36] = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    let profile = reference_aligner();
    assert!(propose_region(&Mesh::new(&positions, &indices), &Tuning::defaults(profile), profile).is_err());
    let tiny = [0f32; 9];
    assert!(matches!(orient_dental(&Mesh::new(&tiny, &[0, 1, 2]), profile), Orientation::Failed { mesh_ok: false, .. }));
}

/// The detection is kept per (mesh bits, profile): another tuning reuses it, a changed key recomputes.
#[test]
fn detection_is_cached_and_a_changed_key_recomputes() {
    use mixo_geometry_core::dental::cache::{cache_stats, clear_cache};
    clear_cache();
    let (positions, indices) = reference();
    let profile = reference_aligner();
    let mesh = Mesh::new(&positions, &indices);
    let base = Tuning::defaults(profile);
    let (h0, m0) = cache_stats();
    let first = propose_region(&mesh, &base, profile).expect("region");
    assert_eq!(cache_stats(), (h0, m0 + 1), "the first detection is computed");
    let again = propose_region(&mesh, &base, profile).expect("region");
    assert_eq!(cache_stats(), (h0 + 1, m0 + 1), "the same mesh and profile reuse it");
    assert_eq!(again, first, "a cached detection gives the same region");
    let wider = Tuning { strip_width_mm: base.strip_width_mm + 0.5, ..base };
    let retuned = propose_region(&mesh, &wider, profile).expect("region");
    assert_eq!(cache_stats(), (h0 + 2, m0 + 1), "another tuning reuses the detection and re-tunes the strip");
    assert_eq!(retuned.contours, first.contours);
    // One moved vertex coordinate (one bit) is another mesh: recompute.
    let mut moved = positions.clone();
    moved[0] = f32::from_bits(moved[0].to_bits() ^ 1);
    let _ = propose_region(&Mesh::new(&moved, &indices), &base, profile);
    assert_eq!(cache_stats().1, m0 + 2, "a changed mesh recomputes");
    clear_cache();
    let _ = propose_region(&mesh, &base, profile);
    assert_eq!(cache_stats().1, m0 + 3, "a cleared cache recomputes");
}
