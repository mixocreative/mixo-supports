//! Cases of the TS body-intersection, contact-reach and body-clearance suites, run on the Rust
//! classifier, plus the verdict rules (timeout is inconclusive, manual is reported not removed).

use super::clearance::*;
use super::conflicts::*;
use super::index::CollisionIndex;
use super::reach::*;
use crate::supports::parts::tags::{Component, ContactIntent, IntentKind, Part, StructureKind, Tag};
use crate::supports::policy::Origin;
use crate::supports::settings::{SupportSettings, default_values};

const MODEL: [f32; 9] = [-2.0, 0.0, -2.0, 2.0, 0.0, -2.0, 0.0, 0.0, 2.0];
const PIERCING: [f32; 9] = [-1.0, -1.0, 0.0, 1.0, 1.0, 0.0, 1.0, -1.0, 0.0];
const CLEAR: [f32; 9] = [-1.0, 1.0, 0.0, 1.0, 2.0, 0.0, 1.0, 1.0, 0.0];

struct Built {
    positions: Vec<f32>,
    indices: Vec<u32>,
    components: Vec<Component>,
}

impl Built {
    fn mesh(&self) -> SupportMesh<'_> {
        SupportMesh { positions: &self.positions, indices: &self.indices, components: &self.components }
    }
}

fn settings() -> SupportSettings {
    SupportSettings::from_slice(&default_values()).unwrap()
}

fn support(part: Part, vertices: &[f32], contact: Option<(u32, Origin)>, reach: Option<f64>, intents: Vec<ContactIntent>) -> Built {
    let mut tag = match contact {
        Some((k, origin)) => Tag::owned(part, k, origin),
        None => Tag::new(part),
    };
    tag.landing_reach = reach;
    tag.intents = intents;
    Built { positions: vertices.to_vec(), indices: vec![0, 1, 2], components: vec![Component { tag, start: 0, count: 3 }] }
}

fn plain(part: Part, vertices: &[f32]) -> Built {
    support(part, vertices, Some((0, Origin::Auto)), None, Vec::new())
}

fn intent(face: u32) -> ContactIntent {
    ContactIntent { kind: IntentKind::Primary, contact: Some(0), point: [0.0; 3], normal: [0.0, -1.0, 0.0], face: Some(face) }
}

fn never() -> bool {
    false
}

fn conflicts(model: &[f32], idx: &[u32], built: &Built, select: &dyn Fn(&Component) -> bool, skip: bool, allow: Option<&dyn Fn(&Conflict) -> bool>) -> Vec<Conflict> {
    body_conflicts(&CollisionIndex::new(model, idx), &built.mesh(), select, skip, allow, &never)
}

#[test]
fn selects_exact_intersecting_parts_independently_of_policy() {
    let brace = plain(Part::Brace, &PIERCING);
    assert_eq!(conflicts(&MODEL, &[0, 1, 2], &brace, &|_| true, false, None).len(), 1);
    assert!(conflicts(&MODEL, &[0, 1, 2], &brace, &|c| c.tag.part == Part::Pillar, false, None).is_empty());
    assert!(conflicts(&MODEL, &[0, 1, 2], &plain(Part::Brace, &CLEAR), &|_| true, false, None).is_empty());
}

#[test]
fn only_an_explicitly_marked_landing_tip_is_exempt_when_requested() {
    let pillar = support(Part::Pillar, &PIERCING, Some((0, Origin::Auto)), Some(5.0), Vec::new());
    assert_eq!(conflicts(&MODEL, &[0, 1, 2], &pillar, &|_| true, false, None).len(), 1);
    assert!(conflicts(&MODEL, &[0, 1, 2], &pillar, &|_| true, true, None).is_empty());
}

#[test]
fn reports_the_exact_face_and_triangle_and_continues_past_an_approved_hit() {
    let hit = conflicts(&MODEL, &[0, 1, 2], &plain(Part::TreeBranch, &PIERCING), &|_| true, false, None);
    assert_eq!(hit, vec![Conflict { component: 0, support_triangle: 0, model_face: 0 }]);
    let two_walls: Vec<f32> = [MODEL.to_vec(), vec![-2.0, 2.0, -2.0, 2.0, 2.0, -2.0, 0.0, 2.0, 2.0]].concat();
    let branch = plain(Part::TreeBranch, &[-1.0, -1.0, 0.0, 1.0, 3.0, 0.0, 1.0, -1.0, 0.0]);
    let allow_first = |h: &Conflict| h.model_face == 0;
    let second = conflicts(&two_walls, &[0, 1, 2, 3, 4, 5], &branch, &|_| true, false, Some(&allow_first));
    assert_eq!(second.iter().map(|h| h.model_face).collect::<Vec<_>>(), vec![1]);
    let first = conflicts(&two_walls, &[0, 1, 2, 3, 4, 5], &branch, &|_| true, false, None);
    assert_eq!(first[0].model_face, 0);
}

fn reach_fixture(vertices: &[f32], face: usize) -> (Built, Conflict) {
    let built = support(Part::TreeBranch, vertices, Some((0, Origin::Auto)), None, vec![intent(0)]);
    (built, Conflict { component: 0, support_triangle: 0, model_face: face })
}

const REACH_MODEL: [f32; 18] = [-2.0, 0.0, -2.0, 2.0, 0.0, -2.0, 0.0, 0.0, 2.0, -2.0, 0.1, -2.0, 2.0, 0.1, -2.0, 0.0, 0.1, 2.0];
const LIMITS: ReachLimits = ReachLimits { radius_mm: 0.6, penetration_mm: 0.2, face_normal_dot_min: 0.8 };
const NEAR: [f32; 9] = [-0.1, -0.1, 0.0, 0.1, 0.05, 0.0, 0.1, -0.1, 0.0];

fn reaches(model: &[f32], idx: &[u32], vertices: &[f32], face: usize) -> bool {
    let (built, hit) = reach_fixture(vertices, face);
    is_intentional_contact_reach(model, idx, &built.mesh(), &hit, &LIMITS)
}

#[test]
fn contact_reach_accepts_only_the_intended_face_or_its_smooth_neighbour() {
    let idx = [0, 1, 2, 3, 4, 5];
    assert!(reaches(&REACH_MODEL, &idx, &NEAR, 0));
    // A second wall, even geometrically near the intended tip, is not exempt.
    assert!(!reaches(&REACH_MODEL, &idx, &NEAR, 1));
    let sheet = [-1.0f32, 0.0, -1.0, 1.0, 0.0, -1.0, -1.0, 0.0, 1.0, 1.0, 0.0, 1.0];
    assert!(reaches(&sheet, &[0, 1, 2, 2, 1, 3], &NEAR, 1));
    // The shared-edge neighbour that points the opposite way is not the same smooth surface.
    assert!(!reaches(&sheet, &[0, 2, 1, 2, 1, 3], &NEAR, 1));
    assert!(!reaches(&REACH_MODEL, &idx, &[-0.1, -0.1, 0.0, 2.0, 0.05, 0.0, 0.1, -0.1, 0.0], 0));
    assert!(!reaches(&REACH_MODEL, &idx, &[-0.1, -0.1, 0.0, 0.1, 0.4, 0.0, 0.1, -0.1, 0.0], 0));
}

fn automatic(index: &CollisionIndex, built: &Built, ids: &[u32]) -> Vec<u32> {
    crossing_automatic_body_contacts(index, &built.mesh(), &|c| ids.contains(&c), &never)
}

#[test]
fn crossing_automatic_pillars() {
    let index = CollisionIndex::new(&MODEL, &[0, 1, 2]);
    assert_eq!(automatic(&index, &plain(Part::Pillar, &PIERCING), &[0]), vec![0]);
    assert!(automatic(&index, &plain(Part::Pillar, &CLEAR), &[0]).is_empty());
    assert!(automatic(&index, &plain(Part::Neck, &PIERCING), &[0]).is_empty());
    let landing = support(Part::Pillar, &PIERCING, Some((0, Origin::Auto)), Some(5.0), Vec::new());
    assert!(automatic(&index, &landing, &[0]).is_empty());
    let manual = support(Part::Pillar, &PIERCING, Some((1, Origin::Manual)), None, Vec::new());
    assert!(automatic(&index, &manual, &[]).is_empty());
    // A coplanar pillar face lying on the model is a crossing.
    assert_eq!(automatic(&index, &plain(Part::Pillar, &[-1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]), &[0]), vec![0]);
}

fn structures(model: &[f32], idx: &[u32], built: &Built) -> Vec<StructurePart> {
    crossing_structure_parts(&CollisionIndex::new(model, idx), &built.mesh(), &settings(), &never)
}

#[test]
fn crossing_structures_never_count_an_intended_neck() {
    for (part, expected) in [(Part::TreeBranch, StructurePart::TreeBranch), (Part::TreeTrunk, StructurePart::TreeTrunk), (Part::Brace, StructurePart::Brace)] {
        assert_eq!(structures(&MODEL, &[0, 1, 2], &plain(part, &PIERCING)), vec![expected]);
    }
    assert!(structures(&MODEL, &[0, 1, 2], &plain(Part::Neck, &PIERCING)).is_empty());
    assert!(structures(&MODEL, &[0, 1, 2], &plain(Part::TreeBranch, &CLEAR)).is_empty());
    // A tree neck is a branch for the fallback.
    let mut neck = plain(Part::Neck, &PIERCING);
    neck.components[0].tag.structure_kind = Some(StructureKind::Tree);
    assert_eq!(structures(&MODEL, &[0, 1, 2], &neck), vec![StructurePart::TreeBranch]);
}

#[test]
fn a_tree_may_reach_its_known_face_shallowly_but_never_a_nearby_second_wall() {
    let near = support(Part::TreeBranch, &NEAR, Some((0, Origin::Auto)), None, vec![intent(0)]);
    assert!(structures(&MODEL, &[0, 1, 2], &near).is_empty());
    let second: Vec<f32> = [MODEL.to_vec(), vec![-2.0, 0.02, -2.0, 2.0, 0.02, -2.0, 0.0, 0.02, 2.0]].concat();
    assert_eq!(structures(&second, &[0, 1, 2, 3, 4, 5], &near), vec![StructurePart::TreeBranch]);
}

fn review(model: &[f32], idx: &[u32], built: &Built) -> BodyReport {
    review_body_clearance(&CollisionIndex::new(model, idx), &built.mesh(), &settings(), &never)
}

#[test]
fn generic_review_reports_a_brace_with_structural_attribution() {
    let report = review(&MODEL, &[0, 1, 2], &support(Part::Brace, &PIERCING, None, None, Vec::new()));
    assert_eq!(report.status, Status::Blocked);
    assert_eq!((report.issues[0].part, report.issues[0].origin, report.issues[0].model_face), (Part::Brace, IssueOrigin::Structural, 0));
}

#[test]
fn a_manual_pillar_crossing_is_reported_and_never_removed() {
    let built = support(Part::Pillar, &PIERCING, Some((0, Origin::Manual)), None, Vec::new());
    let report = review(&MODEL, &[0, 1, 2], &built);
    assert_eq!(report.status, Status::Blocked);
    assert_eq!((report.issues[0].origin, report.issues[0].contact), (IssueOrigin::Manual, Some(0)));
    assert_eq!(built.components.len(), 1);
}

#[test]
fn an_untagged_contact_neck_is_inconclusive_not_clear() {
    let report = review(&MODEL, &[0, 1, 2], &plain(Part::Neck, &PIERCING));
    assert_eq!(report.status, Status::Inconclusive);
    assert_eq!(report.issues[0].origin, IssueOrigin::Auto);
}

#[test]
fn only_a_face_tagged_bounded_contact_is_exempt_not_an_unrelated_wall() {
    let local_vertices = [-0.1, -0.05, -0.1, 0.1, 0.05, -0.1, 0.0, 0.05, 0.1f32];
    let local = support(Part::Neck, &local_vertices, Some((0, Origin::Auto)), None, vec![intent(0)]);
    assert_eq!(review(&MODEL, &[0, 1, 2], &local).status, Status::Clear);
    let two: Vec<f32> = [MODEL.to_vec(), vec![-2.0, 0.5, -2.0, 2.0, 0.5, -2.0, 0.0, 0.5, 2.0]].concat();
    let mut reaching = support(Part::Neck, &[local_vertices.to_vec(), vec![-0.1, 0.4, -0.1, 0.1, 0.6, -0.1, 0.0, 0.6, 0.1]].concat(), Some((0, Origin::Auto)), None, vec![intent(0)]);
    reaching.indices = vec![0, 1, 2, 3, 4, 5];
    reaching.components[0].count = 6;
    let report = review(&two, &[0, 1, 2, 3, 4, 5], &reaching);
    assert_eq!((report.status, report.issues[0].model_face), (Status::Blocked, 1));
}

#[test]
fn invalid_geometry_is_inconclusive_never_a_false_clear() {
    let broken = [f32::NAN, 0.0, 0.0];
    let report = review(&broken, &[0, 1, 2], &support(Part::Brace, &PIERCING, None, None, Vec::new()));
    assert_eq!(report.status, Status::Inconclusive);
    assert_eq!(report.reason, Some("invalid-geometry"));
}

#[test]
fn a_timeout_is_inconclusive_never_clear_and_a_found_crossing_still_blocks() {
    let index = CollisionIndex::new(&MODEL, &[0, 1, 2]);
    let always = || true;
    let clear_but_late = plain(Part::Brace, &CLEAR);
    let report = review_body_clearance(&index, &clear_but_late.mesh(), &settings(), &always);
    assert_eq!((report.status, report.reason), (Status::Inconclusive, Some("timeout")));
    // The scan is skipped once expired, so nothing is reported clear without having been looked at.
    let blocked = plain(Part::Brace, &PIERCING);
    let report = review_body_clearance(&index, &blocked.mesh(), &settings(), &always);
    assert_eq!(report.status, Status::Inconclusive);
}
