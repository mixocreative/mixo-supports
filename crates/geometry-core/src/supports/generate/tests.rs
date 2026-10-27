use super::*;
use crate::core::spatial::Bvh;
use crate::supports::parts::column::ContactKind;
use crate::supports::parts::tags::Part;
use crate::supports::policy::{AllowedStructures, AreaStamp, AutomaticRule, Candidate, CandidateId, FaceMask, LandingRule, Origin, Ring};
use crate::supports::settings::{SETTINGS_LAYOUT, SupportSettings, default_values};

type V = [f64; 3];

/// Outward-facing axis-aligned boxes as one mesh (12 triangles each).
fn boxes(list: &[(V, V)]) -> (Vec<f32>, Vec<u32>) {
    let (mut positions, mut indices) = (Vec::new(), Vec::new());
    for &([x0, y0, z0], [x1, y1, z1]) in list {
        let base = positions.len() as u32 / 3;
        for [x, y, z] in [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] {
            positions.extend([x as f32, y as f32, z as f32]);
        }
        for f in [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]] {
            indices.extend([base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]]);
        }
    }
    (positions, indices)
}

fn settings(overrides: &[(&str, f64)]) -> SupportSettings {
    let mut values = default_values();
    for &(name, value) in overrides {
        values[SETTINGS_LAYOUT.iter().position(|n| *n == name).unwrap()] = value;
    }
    SupportSettings::from_slice(&values).unwrap()
}

/// Columns only on a flat plate, low poly: fast and deterministic.
fn plain_settings(extra: &[(&str, f64)]) -> SupportSettings {
    let mut all = vec![("trussEnabled", 0.0), ("raftEnabled", 0.0), ("scatterAutoTree", 0.0), ("lowPolyMode", 1.0)];
    all.extend_from_slice(extra);
    settings(&all)
}

fn contact(id: &str, point: V, origin: Origin) -> ColumnContact {
    ColumnContact {
        candidate: Candidate { id: CandidateId(id.into()), source_face: None, point, normal: [0.0, -1.0, 0.0], origin },
        shape: None,
        landing: None,
        kind: ContactKind::default(),
    }
}

fn structures(tree: bool, brace: bool) -> AllowedStructures {
    AllowedStructures { pillar: true, tree, brace, roof: true, cage: true, raft: true }
}

fn policy(faces: usize, candidates: Vec<Candidate>, budget: u32, automatic: AutomaticRule) -> PolicyResult {
    PolicyResult { automatic, ..PolicyResult::plain(FaceMask::new(faces), candidates, structures(true, true), budget) }
}

fn never() -> bool {
    false
}

struct Fixture {
    positions: Vec<f32>,
    indices: Vec<u32>,
    bvh: Bvh,
}

impl Fixture {
    fn new(list: &[(V, V)]) -> Self {
        let (positions, indices) = boxes(list);
        let bvh = Bvh::build(&positions, &indices);
        Self { positions, indices, bvh }
    }
    fn faces(&self) -> usize {
        self.indices.len() / 3
    }
    fn run(&self, contacts: Vec<ColumnContact>, s: &SupportSettings, p: &PolicyResult, expired: &dyn Fn() -> bool) -> Generated {
        let model = Model::new(&self.positions, &self.indices, &self.bvh);
        generate(GenerateInput { contacts, settings: s, mode: BuildMode::Preview, model: Some(&model), label_text: "", zones: &[], policy: p, expired }).unwrap()
    }
}

/// Shelf (underside y = 20) over two walls leaving a 0.6 mm gap that the pillar (wider) cannot fit.
fn two_walls() -> Fixture {
    Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0]), ([-20.0, 0.0, -5.0], [-0.3, 12.0, 5.0]), ([0.3, 0.0, -5.0], [20.0, 12.0, 5.0])])
}

fn ids(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

#[test]
fn a_clear_support_is_clear_and_every_component_is_attributed() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0])]);
    let out = fixture.run(vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven), &never);
    assert_eq!(out.verdict.status, Status::Clear, "{:?}", out.verdict);
    assert_eq!(out.contact_ids, vec!["a"]);
    assert!(out.dropped.is_empty() && out.fallback.is_empty() && out.trials == 0);
    assert!(out.built.components.iter().all(|c| c.tag.contact == Some(0)));
}

#[test]
fn two_walls_block_a_pillar_that_fits_neither_gap() {
    let fixture = two_walls();
    let report = fixture.run(vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven), &never);
    // Reporting policy (budget 0): the pillar is kept and the verdict names the wall it crosses.
    assert_eq!(report.verdict.status, Status::Blocked);
    assert!(report.verdict.issues.iter().any(|i| i.blocked && i.part == Part::Pillar && i.contact == Some(0)));
    assert!(report.dropped.is_empty() && report.contact_ids == vec!["a"]);
}

#[test]
fn repair_leaves_a_crossing_automatic_contact_out_but_never_a_manual_one() {
    let fixture = two_walls();
    let candidate = Candidate { id: CandidateId("cand".into()), source_face: Some(0), point: [0.0, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    let p = policy(fixture.faces(), vec![candidate], 8, AutomaticRule::MatchCandidates);
    let manual = contact("hand", [3.0, 20.0, 0.0], Origin::Manual);
    let out = fixture.run(vec![contact("auto-0", [0.0, 20.0, 0.0], Origin::Auto), manual], &plain_settings(&[]), &p, &never);
    assert!(out.dropped.contains(&"auto-0".to_string()), "{:?}", out.dropped);
    assert!(!out.contact_ids.contains(&"auto-0".to_string()));
    // The manual contact is still built; if it crosses the verdict says so instead of removing it.
    assert!(out.built.components.iter().any(|c| c.tag.contact.is_some_and(|k| out.contact_ids[k as usize] == "hand")));
    assert!(out.trials >= 1 && out.trials <= 8);
}

#[test]
fn an_automatic_contact_that_reproduces_no_candidate_is_left_out_and_a_match_takes_its_source_face() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0])]);
    let candidate = Candidate { id: CandidateId("cand".into()), source_face: Some(3), point: [0.0, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    let p = policy(fixture.faces(), vec![candidate], 8, AutomaticRule::MatchCandidates);
    let forged = contact("forged", [5.0, 20.0, 0.0], Origin::Auto);
    let near = contact("near", [0.01, 20.0, 0.0], Origin::Auto);
    let out = fixture.run(vec![near, forged], &plain_settings(&[]), &p, &never);
    assert_eq!(ids(&out.dropped), vec!["forged"]);
    assert_eq!(out.contact_ids, vec!["near"]);
    let neck = out.built.components.iter().find(|c| c.tag.part == Part::Neck).unwrap();
    assert_eq!(neck.tag.intents[0].face, Some(3));
}

#[test]
fn a_crossing_contact_moves_to_the_policy_alternate_instead_of_being_dropped() {
    // The walls end at x = 2: an alternate at x = 4 has a free run to the plate.
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0]), ([-20.0, 0.0, -5.0], [-0.3, 12.0, 5.0]), ([0.3, 0.0, -5.0], [2.0, 12.0, 5.0])]);
    // Faces 4 and 5 are the shelf underside (the bottom quad of the first box).
    let cand = |id: &str, x: f64| Candidate { id: CandidateId(id.into()), source_face: Some(4), point: [x, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    let mut p = policy(fixture.faces(), vec![cand("primary", 0.0)], 8, AutomaticRule::MatchCandidates);
    p.alternates = vec![(CandidateId("primary".into()), vec![cand("alt", 4.0)])];
    let out = fixture.run(vec![contact("auto-0", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
    // Moved, not dropped: the contact list now holds the alternate.
    assert!(out.dropped.is_empty(), "{:?}", out.dropped);
    assert_eq!(out.contact_ids, vec!["auto-400_2000_0"]);
    assert_eq!(out.trials, 1);
    assert_eq!(out.verdict.status, Status::Clear, "{:?}", out.verdict);
}

#[test]
fn a_zero_budget_never_repairs_and_a_timeout_is_inconclusive_never_clear() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0])]);
    let p = policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven);
    let always = || true;
    let out = fixture.run(vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &always);
    assert_eq!((out.verdict.status, out.verdict.reason), (Status::Inconclusive, Some("timeout")));
    assert_eq!(out.islands, IslandVerdict::Inconclusive("timeout"));
    // The same model and support without a deadline is clear.
    let ok = fixture.run(vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
    assert_eq!(ok.verdict.status, Status::Clear);
}

#[test]
fn a_secondary_landing_off_the_approved_faces_is_left_out_by_the_landing_rule() {
    // Shelf over a slab: the column lands on the slab top (faces 6-7 of the second box are its top).
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0]), ([-20.0, 5.0, -20.0], [20.0, 9.0, 20.0])]);
    let mut p = policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven);
    let build = |p: &PolicyResult| fixture.run(vec![contact("auto-shelf", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), p, &never);
    assert!(build(&p).dropped.is_empty());
    // Approved faces: none painted, so the landing is forbidden and the automatic support is left out.
    p.landing_rule = LandingRule::ApprovedFaces { stamps: Vec::new() };
    assert_eq!(ids(&build(&p).dropped), vec!["auto-shelf"]);
    // Painting every face approves it; a later erase stamp over the landing forbids it again.
    for face in 0..fixture.faces() {
        p.permitted_faces.set(face, true);
    }
    assert!(build(&p).dropped.is_empty());
    let erase = AreaStamp { center: [0.0, 9.0, 0.0], radius: 3.0, normal: [0.0, 1.0, 0.0], allow: false };
    p.landing_rule = LandingRule::ApprovedFaces { stamps: vec![erase] };
    assert_eq!(ids(&build(&p).dropped), vec!["auto-shelf"]);
    // A manual contact is never left out by the rule.
    let manual = fixture.run(vec![contact("hand", [0.0, 20.0, 0.0], Origin::Manual)], &plain_settings(&[]), &p, &never);
    assert!(manual.dropped.is_empty());
}

#[test]
fn a_brace_through_the_model_is_a_blocked_structure_or_switched_off_by_the_repair() {
    // Two columns under a shelf with a thin wall between them that the brace has to pass through.
    let fixture = Fixture::new(&[([-9.0, 20.0, -5.0], [9.0, 24.0, 5.0]), ([-0.4, 0.0, -5.0], [0.4, 19.0, 5.0])]);
    let s = settings(&[("trussEnabled", 1.0), ("raftEnabled", 0.0), ("scatterAutoTree", 0.0), ("lowPolyMode", 1.0), ("trussMinHeight", 1.0)]);
    let two = || vec![contact("left", [-6.0, 20.0, 0.0], Origin::Auto), contact("right", [6.0, 20.0, 0.0], Origin::Auto)];
    let reporting = fixture.run(two(), &s, &policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven), &never);
    assert!(reporting.built.components.iter().any(|c| c.tag.part == Part::Brace), "no brace was built");
    assert!(reporting.verdict.issues.iter().any(|i| i.part == Part::Brace && i.blocked), "{:?}", reporting.verdict);
    let repaired = fixture.run(two(), &s, &policy(fixture.faces(), Vec::new(), 8, AutomaticRule::AsGiven), &never);
    assert!(repaired.fallback.contains(&Fallback::Brace));
    assert!(!repaired.built.components.iter().any(|c| c.tag.part == Part::Brace));
    assert!(repaired.verdict.status != Status::Blocked, "{:?}", repaired.verdict);
    assert_eq!(repaired.contact_ids, vec!["left", "right"]);
}

#[test]
fn a_tree_with_both_leaves_on_its_own_surface_is_clear_round_and_shaped() {
    let fixture = Fixture::new(&[([-9.0, 20.0, -5.0], [9.0, 24.0, 5.0])]);
    for shaped in [false, true] {
        let mut extra = vec![("trussEnabled", 0.0), ("raftEnabled", 0.0), ("scatterAutoTree", 1.0), ("lowPolyMode", 1.0)];
        if shaped {
            extra.push(("tipSection", 1.0));
        }
        let s = settings(&extra);
        let contacts = vec![contact("l", [-0.3, 20.0, 0.0], Origin::Auto), contact("r", [0.3, 20.0, 0.0], Origin::Auto)];
        let out = fixture.run(contacts, &s, &policy(fixture.faces(), Vec::new(), 8, AutomaticRule::AsGiven), &never);
        let parts: Vec<Part> = out.built.components.iter().map(|c| c.tag.part).collect();
        assert!(parts.contains(&Part::TreeBranch), "shaped={shaped} {parts:?}");
        assert_eq!(out.verdict.status, Status::Clear, "shaped={shaped} {:?}", out.verdict);
        assert!(out.fallback.is_empty(), "shaped={shaped}");
    }
}

#[test]
fn a_neighbouring_wall_that_the_tip_only_nears_is_not_a_crossing() {
    // A wall 0.35 mm beside the support: the tube does not reach it.
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0]), ([1.2, 6.0, -5.0], [3.0, 19.0, 5.0])]);
    let out = fixture.run(vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[("pillarDiameter", 1.0)]), &policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven), &never);
    assert_eq!(out.verdict.status, Status::Clear, "{:?}", out.verdict);
}

#[test]
fn generic_roof_and_cage_are_built_when_allowed_and_absent_when_the_policy_forbids_them() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0])]);
    let s = settings(&[("trussEnabled", 0.0), ("scatterAutoTree", 0.0), ("lowPolyMode", 1.0), ("roofMode", 2.0)]);
    let contacts = || vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)];
    let has_cage = |g: &Generated| g.built.components.iter().any(|c| matches!(c.tag.part, Part::CageRing | Part::Roof | Part::CrossBar | Part::RoofBrace | Part::Column));
    let allowed = fixture.run(contacts(), &s, &policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven), &never);
    assert!(has_cage(&allowed));
    assert!(allowed.verdict.status != Status::Blocked, "{:?}", allowed.verdict);
    let mut off = policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven);
    off.structures = AllowedStructures { roof: false, cage: false, ..structures(true, true) };
    assert!(!has_cage(&fixture.run(contacts(), &s, &off, &never)));
}

#[test]
fn islands_resolve_through_built_supports_and_stay_unresolved_without_them() {
    // A box with its underside at y = 5 on a closed solid: one island at the bottom plateau.
    let fixture = Fixture::new(&[([-5.0, 5.0, -5.0], [5.0, 15.0, 5.0])]);
    let p = policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven);
    let none = fixture.run(Vec::new(), &plain_settings(&[]), &p, &never);
    let IslandVerdict::Ok(islands) = &none.islands else { panic!("{:?}", none.islands) };
    assert_eq!((islands.len(), islands[0].status), (1, IslandStatus::Unresolved));
    let supported = fixture.run(vec![contact("a", [0.0, 5.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
    let IslandVerdict::Ok(islands) = &supported.islands else { panic!("{:?}", supported.islands) };
    assert_eq!((islands[0].status, islands[0].manual_only), (IslandStatus::Resolved, false));
    // A manual-only route is reported as such, never as an automatic one.
    let by_hand = fixture.run(vec![contact("h", [0.0, 5.0, 0.0], Origin::Manual)], &plain_settings(&[]), &p, &never);
    let IslandVerdict::Ok(islands) = &by_hand.islands else { panic!("{:?}", by_hand.islands) };
    assert_eq!((islands[0].status, islands[0].manual_only), (IslandStatus::Resolved, true));
    // A support too far from the lowest point does not serve it: proximity is not a path.
    let far = fixture.run(vec![contact("far", [40.0, 5.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
    let IslandVerdict::Ok(islands) = &far.islands else { panic!("{:?}", far.islands) };
    assert_eq!(islands[0].status, IslandStatus::Unresolved);
}

#[test]
fn an_island_outside_the_permitted_area_is_classified_apart_from_unresolved() {
    let fixture = Fixture::new(&[([-5.0, 5.0, -5.0], [5.0, 15.0, 5.0])]);
    let status = |p: &PolicyResult| {
        let out = fixture.run(Vec::new(), &plain_settings(&[]), p, &never);
        let IslandVerdict::Ok(islands) = &out.islands else { panic!("{:?}", out.islands) };
        islands.iter().map(|i| i.status).collect::<Vec<_>>()
    };
    // The generic policy permits everything: unchanged, even with an empty mask.
    assert_eq!(status(&policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven)), vec![IslandStatus::Unresolved]);
    // An approved-area policy whose area misses the island's faces: outside, not unresolved.
    let mut approved = policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven);
    approved.landing_rule = LandingRule::ApprovedFaces { stamps: Vec::new() };
    assert_eq!(status(&approved), vec![IslandStatus::OutsidePolicy]);
    // The same policy with the whole model permitted keeps it unresolved (listed with Fix).
    for face in 0..fixture.faces() {
        approved.permitted_faces.set(face, true);
    }
    assert_eq!(status(&approved), vec![IslandStatus::Unresolved]);
}

#[test]
fn ring_coverage_counts_only_built_contacts_of_the_ring() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0])]);
    let cand = |id: &str, x: f64| Candidate { id: CandidateId(id.into()), source_face: Some(0), point: [x, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    let mut p = policy(fixture.faces(), vec![cand("c0", -3.0), cand("c1", 3.0)], 8, AutomaticRule::MatchCandidates);
    p.rings = vec![Ring { perimeter_mm: 20.0, spacing_mm: 3.0, arcs: vec![(CandidateId("c0".into()), 2.0), (CandidateId("c1".into()), 12.0)] }];
    let out = fixture.run(vec![contact("a", [-3.0, 20.0, 0.0], Origin::Auto), contact("b", [3.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
    assert_eq!(out.rings.len(), 1);
    assert_eq!((out.rings[0].retained, out.rings[0].max_gap_mm, out.rings[0].needs_review), (2, 10.0, true));
}

#[test]
fn structure_flags_are_an_upper_bound_on_the_settings() {
    let s = settings(&[("trussEnabled", 1.0), ("scatterAutoTree", 1.0), ("raftEnabled", 1.0)]);
    let limited = limit_structures(&s, &AllowedStructures { pillar: true, tree: false, brace: false, roof: false, cage: false, raft: false });
    assert!(!limited.scatter_auto_tree && !limited.truss_enabled && !limited.raft_enabled);
    assert_eq!(limit_structures(&s, &structures(true, true)), s);
}

fn issue(contact: Option<u32>, blocked: bool) -> BodyIssue {
    BodyIssue { part: Part::Pillar, contact, origin: crate::supports::safety::clearance::IssueOrigin::Auto, model_face: 0, blocked }
}

#[test]
fn a_crossing_withdraws_only_its_own_contact_unless_it_has_no_owner() {
    assert_eq!(withdrawn_contacts(&[issue(Some(1), true)], 3), vec![false, true, false]);
    // An uncertain (not blocked) entry withdraws nothing.
    assert_eq!(withdrawn_contacts(&[issue(Some(1), false)], 2), vec![false, false]);
    // A trunk or brace crossing has no owner: all are withdrawn, and the verdict says it was a guess.
    assert_eq!(withdrawn_contacts(&[issue(None, true)], 2), vec![true, true]);
}

#[test]
fn a_pillar_crossing_is_attributed_so_the_verdict_is_not_flagged_unattributed() {
    let fixture = two_walls();
    let out = fixture.run(vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven), &never);
    assert_eq!(out.verdict.status, Status::Blocked);
    assert!(!out.verdict.unattributed_crossing);
}

#[test]
fn the_repair_never_spends_more_than_its_budget() {
    let fixture = two_walls();
    let candidate = Candidate { id: CandidateId("cand".into()), source_face: Some(0), point: [0.0, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    for budget in 1..=4 {
        let p = policy(fixture.faces(), vec![candidate.clone()], budget, AutomaticRule::MatchCandidates);
        let out = fixture.run(vec![contact("auto-0", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
        assert!(out.trials <= budget, "budget {budget} spent {}", out.trials);
    }
    // A budget of 1 still gets the one rebuild that leaves the crossing contact out.
    let p = policy(fixture.faces(), vec![candidate], 1, AutomaticRule::MatchCandidates);
    let out = fixture.run(vec![contact("auto-0", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
    assert_eq!(out.trials, 1);
    assert!(out.dropped.contains(&"auto-0".to_string()));
}

#[test]
fn a_ring_that_cannot_be_measured_is_inconclusive_not_a_full_perimeter_gap() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0])]);
    let mut p = policy(fixture.faces(), Vec::new(), 0, AutomaticRule::AsGiven);
    p.rings = vec![Ring { perimeter_mm: 20.0, spacing_mm: 0.0, arcs: Vec::new() }];
    let out = fixture.run(vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
    assert!(out.rings.is_empty());
    assert_eq!((out.verdict.status, out.verdict.reason), (Status::Inconclusive, Some("Invalid ring measure")));
}
