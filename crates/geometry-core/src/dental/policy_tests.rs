use super::super::profiles::reference_aligner;
use super::*;
use crate::core::matrix::placement_matrix;

// Two facing-up triangles and one facing down, all near the origin.
const POSITIONS: [f32; 27] = [0., 0., 0., 1., 0., 0., 0., 0., 1., 2., 0., 0., 3., 0., 0., 2., 0., 1., 0., 5., 0., 0., 5., 1., 1., 5., 0.];
const INDICES: [u32; 9] = [0, 2, 1, 3, 5, 4, 6, 7, 8];
const BOTH: DentalStructure = DentalStructure { tree: true, brace: true };

fn input<'a>(mesh: &'a Mesh<'a>, area: DentalArea<'a>, stamps: &'a [AreaStamp], frame: &'a Matrix4) -> DentalPolicyInput<'a> {
    DentalPolicyInput { mesh, profile: reference_aligner(), area, stamps, structure: BOTH, frame }
}

#[test]
fn structures_follow_the_switches_with_roof_and_cage_always_off() {
    let s = dental_structures(DentalStructure { tree: false, brace: true });
    assert_eq!((s.pillar, s.tree, s.brace, s.roof, s.cage, s.raft), (true, false, true, false, false, true));
}

#[test]
fn a_painted_area_permits_its_own_contacts_and_keeps_landings_on_the_paint() {
    let mesh = Mesh::new(&POSITIONS, &INDICES);
    let up = Stamp { center: [0.3, 0.0, 0.3], radius: 5.0, normal: [0.0, 1.0, 0.0], allow: true };
    let frame = placement_matrix([0.0, 10.0, 0.0], [0.0, 0.0, 0.0]);
    let policy = dental_policy(&input(&mesh, DentalArea::ManualArea, &[up], &frame));
    assert_eq!(policy.area_origin, AreaOrigin::ManualArea);
    assert_eq!(policy.profile_id, "reference-aligner");
    let r = &policy.result;
    assert_eq!(r.automatic, AutomaticRule::AsGiven, "the fill contacts are the area's own");
    assert!(r.permitted_faces.get(0) && r.permitted_faces.get(1) && !r.permitted_faces.get(2));
    let LandingRule::ApprovedFaces { stamps } = &r.landing_rule else { panic!("{:?}", r.landing_rule) };
    assert_eq!(stamps[0].center, [0.3, 10.0, 0.3], "stamps are in the output frame");
    assert!(r.islands_outside_permitted && r.candidates.is_empty() && r.rings.is_empty());
    assert_eq!(r.repair_budget, reference_aligner().defaults.repair_budget);
}

#[test]
fn an_older_saved_policy_permits_nothing_automatic() {
    let mesh = Mesh::new(&POSITIONS, &INDICES);
    let frame = placement_matrix([0.0; 3], [0.0; 3]);
    let policy = dental_policy(&input(&mesh, DentalArea::Legacy, &[], &frame));
    assert_eq!(policy.area_origin, AreaOrigin::Legacy);
    let d = &reference_aligner().defaults;
    assert_eq!(policy.result.automatic, AutomaticRule::MatchCandidates { tol_mm: d.match_tolerance_mm, min_dot: d.match_min_dot });
    assert!(policy.result.candidates.is_empty() && policy.result.permitted_faces.count() == 0);
    assert!(!policy.result.structures.roof && !policy.result.structures.cage);
    assert_eq!(policy.result.structure_choice, Some(StructureChoice { tree: true, brace: true }), "the switches, not the settings");
}

#[test]
fn a_saved_region_that_detection_does_not_reproduce_is_closed() {
    let mesh = Mesh::new(&POSITIONS, &INDICES);
    let frame = placement_matrix([0.0; 3], [0.0; 3]);
    let saved = SavedRegion { allowed_faces: &[1, 1, 0], contact_faces: &[1, 1, 0], outer_edges: &[0, 1], opening_edges: &[3, 4] };
    let area = DentalArea::TwoContour { tuning: Tuning::defaults(reference_aligner()), saved };
    let policy = dental_policy(&input(&mesh, area, &[], &frame));
    assert!(!policy.reproduced);
    assert!(policy.result.candidates.is_empty() && policy.result.permitted_faces.count() == 0, "never grandfathered");
    assert!(matches!(policy.result.automatic, AutomaticRule::MatchCandidates { .. }));
}

#[test]
fn the_face_gate_takes_the_last_stamp_that_reaches_the_point() {
    let strip = [1u8, 0];
    let erase = AreaStamp { center: [0.0; 3], radius: 1.0, normal: [0.0, 1.0, 0.0], allow: false };
    let restore = AreaStamp { center: [0.5, 0.0, 0.0], radius: 0.2, normal: [0.0, 1.0, 0.0], allow: true };
    let up = [0.0, 1.0, 0.0];
    assert!(area_allows(&strip, &[], 0, [0.0; 3], up));
    assert!(!area_allows(&strip, &[], 1, [0.0; 3], up), "off the strip");
    assert!(!area_allows(&strip, &[erase], 0, [0.0; 3], up));
    assert!(area_allows(&strip, &[erase], 0, [0.0; 3], [0.0, -1.0, 0.0]), "the far side is not erased");
    assert!(area_allows(&strip, &[erase, restore], 0, [0.5, 0.0, 0.0], up));
    assert!(!area_allows(&strip, &[restore], 1, [0.5, 0.0, 0.0], up), "add paint never crosses the strip");
}

#[test]
fn a_painted_area_is_refused_when_one_was_detected() {
    assert_eq!(manual_area_faces(10, &[2, 3], false).unwrap().count(), 2);
    assert_eq!(manual_area_faces(10, &[2], true), Err(ManualAreaError::DetectedAreaExists));
    assert_eq!(manual_area_faces(10, &[10], false), Err(ManualAreaError::FaceOutOfRange(10)));
}

#[test]
fn stamps_paint_faces_in_order_and_ignore_the_far_side() {
    let mesh = Mesh::new(&POSITIONS, &INDICES);
    let up = Stamp { center: [0.3, 0.0, 0.3], radius: 5.0, normal: [0.0, 1.0, 0.0], allow: true };
    let painted = faces_painted_by_stamps(&mesh, &[up]);
    assert_eq!(painted, vec![0, 1]);
    let erase = Stamp { center: [0.3, 0.0, 0.3], radius: 0.6, normal: [0.0, 1.0, 0.0], allow: false };
    assert_eq!(faces_painted_by_stamps(&mesh, &[up, erase]), vec![1]);
}

#[test]
fn the_switches_decide_tree_and_brace_whatever_the_settings_say() {
    use crate::supports::generate::{chosen_settings, limit_structures};
    use crate::supports::settings::{SupportSettings, default_values};
    let mesh = Mesh::new(&POSITIONS, &INDICES);
    let frame = placement_matrix([0.0; 3], [0.0; 3]);
    let mut settings = SupportSettings::from_slice(&default_values()).unwrap();
    settings.scatter_auto_tree = false;
    settings.truss_enabled = true;
    let mut dental = input(&mesh, DentalArea::Legacy, &[], &frame);
    dental.structure = DentalStructure { tree: true, brace: false };
    let policy = dental_policy(&dental).result;
    let used = limit_structures(&chosen_settings(&settings, &policy), &policy.structures);
    assert!(used.scatter_auto_tree && !used.truss_enabled);
    // The generic policy has no choice: the settings stay as they are.
    let generic = PolicyResult::plain(FaceMask::new(0), Vec::new(), dental_structures(BOTH), 0);
    assert_eq!(chosen_settings(&settings, &generic), settings);
}
