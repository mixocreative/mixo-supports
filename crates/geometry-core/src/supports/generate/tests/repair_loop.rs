use super::super::repair::trace;
use super::*;
use crate::supports::parts::tags::BraceKey;

/// What the repair did, as one comparable line: the trials by step (and contacts touched), the
/// outcome lists and a hash of the built positions. The expected lines were recorded from the loop
/// before it kept one result per query per build, so a repair that reaches the same result by the
/// same trials in the same order passes, and anything else fails.
fn fingerprint(out: &Generated) -> String {
    let log = trace::take();
    assert!(log.iter().all(|t| t.build_ms >= 0.0 && t.check_ms >= 0.0), "{log:?}");
    let steps: Vec<String> = log.iter().map(|t| format!("{}:{}{}", t.step, t.touched, if t.same { ":same" } else { "" })).collect();
    // Rounded to 0.1 µm: float bits differ across platforms' maths libraries.
    let hash = out.built.positions.iter().fold(0xcbf29ce484222325u64, |h, p| (h ^ ((f64::from(*p) * 1e4).round() as i64 as u64)).wrapping_mul(0x100000001b3));
    format!("trials={} steps={:?} dropped={:?} fallback={:?} ids={:?} verdict={:?} positions={}:{:016x}", out.trials, steps, out.dropped, out.fallback, out.contact_ids, out.verdict.status, out.built.positions.len(), hash)
}

fn tilted(id: &str, origin: Origin) -> ColumnContact {
    let mut c = contact(id, [0.0, 20.0, 0.0], origin);
    c.candidate.normal = [std::f64::consts::FRAC_1_SQRT_2, -std::f64::consts::FRAC_1_SQRT_2, 0.0];
    c
}

fn tilted_policy(fixture: &Fixture) -> PolicyResult {
    let candidate = Candidate { id: CandidateId("cand".into()), source_face: Some(4), ..tilted("cand", Origin::Auto).candidate };
    policy(fixture.faces(), vec![candidate], 8, AutomaticRule::MatchCandidates { tol_mm: 0.03, min_dot: 0.95 })
}

fn shelf_and_block(block: (V, V)) -> Fixture {
    Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0]), block])
}

#[test]
fn a_neck_the_first_aim_clears_repairs_in_one_trial() {
    let fixture = shelf_and_block(([0.9, 15.0, -2.0], [3.0, 19.0, 2.0]));
    trace::take();
    let out = fixture.run(vec![tilted("auto-0", Origin::Auto)], &plain_settings(&[]), &tilted_policy(&fixture), &never);
    assert_eq!(fingerprint(&out), EXPECTED[0]);
}

#[test]
fn a_neck_that_crosses_after_every_aim_goes_through_every_step() {
    let fixture = shelf_and_block(([-3.0, 15.0, -3.0], [3.0, 19.5, 3.0]));
    trace::take();
    let out = fixture.run(vec![tilted("auto-0", Origin::Auto), tilted("hand", Origin::Manual)], &plain_settings(&[]), &tilted_policy(&fixture), &never);
    assert_eq!(fingerprint(&out), EXPECTED[1]);
}

#[test]
fn a_pillar_between_two_walls_is_left_out() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0]), ([-20.0, 0.0, -5.0], [-0.3, 12.0, 5.0]), ([0.3, 0.0, -5.0], [20.0, 12.0, 5.0])]);
    let candidate = Candidate { id: CandidateId("cand".into()), source_face: Some(0), point: [0.0, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    let p = policy(fixture.faces(), vec![candidate], 8, AutomaticRule::MatchCandidates { tol_mm: 0.03, min_dot: 0.95 });
    trace::take();
    let out = fixture.run(vec![contact("auto-0", [0.0, 20.0, 0.0], Origin::Auto), contact("hand", [3.0, 20.0, 0.0], Origin::Manual)], &plain_settings(&[]), &p, &never);
    assert_eq!(fingerprint(&out), EXPECTED[2]);
}

#[test]
fn a_crossing_contact_moves_to_its_alternate() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0]), ([-20.0, 0.0, -5.0], [-0.3, 12.0, 5.0]), ([0.3, 0.0, -5.0], [2.0, 12.0, 5.0])]);
    let cand = |id: &str, x: f64| Candidate { id: CandidateId(id.into()), source_face: Some(4), point: [x, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    let mut p = policy(fixture.faces(), vec![cand("primary", 0.0)], 8, AutomaticRule::MatchCandidates { tol_mm: 0.03, min_dot: 0.95 });
    p.alternates = vec![(CandidateId("primary".into()), vec![cand("alt", 4.0)])];
    trace::take();
    let out = fixture.run(vec![contact("auto-0", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &p, &never);
    assert_eq!(fingerprint(&out), EXPECTED[3]);
}

#[test]
fn a_clean_first_build_spends_no_trial() {
    let fixture = Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0])]);
    trace::take();
    let out = fixture.run(vec![contact("a", [0.0, 20.0, 0.0], Origin::Auto)], &plain_settings(&[]), &policy(fixture.faces(), Vec::new(), 8, AutomaticRule::AsGiven), &never);
    assert_eq!((out.trials, trace::take().len()), (0, 0));
}

const EXPECTED: [&str; 4] = [
    r#"trials=1 steps=["reaim-normal:1"] dropped=[] fallback=[] ids=["auto-0"] verdict=Clear positions=168:3182c8676da1f1d5"#,
    r#"trials=2 steps=["reaim-normal:1", "leave-out:1"] dropped=["auto-0"] fallback=[] ids=["hand"] verdict=Blocked positions=138:281c208904fc1ef1"#,
    r#"trials=3 steps=["reaim-normal:1", "reaim-down:1", "leave-out:1"] dropped=["auto-0"] fallback=[] ids=["hand"] verdict=Clear positions=102:71aaedf8353dcc7d"#,
    r#"trials=1 steps=["alternates:1"] dropped=[] fallback=[] ids=["auto-400_2000_0"] verdict=Clear positions=168:a2828132e78a9955"#,
];

/// D20: a brace that first appears after the contact repairs (an alternate brings two pillars within
/// brace reach across a thin wall) is switched off, keeping every contact; Tree was off, so only Brace is reported.
#[test]
fn a_structure_that_still_crosses_after_the_contact_repairs_goes_off_and_the_contacts_stay() {
    // A shelf; a block under the far primary's pillar; a thin wall between the left contact and the alternate.
    let fixture = Fixture::new(&[([-9.0, 20.0, -5.0], [22.0, 24.0, 5.0]), ([19.0, 0.0, -5.0], [21.0, 12.0, 5.0]), ([-0.4, 0.0, -5.0], [0.4, 19.0, 5.0])]);
    let s = settings(&[("trussEnabled", 1.0), ("raftEnabled", 0.0), ("scatterAutoTree", 0.0), ("lowPolyMode", 1.0), ("trussMinHeight", 1.0), ("trussDistanceLimit", 15.0)]);
    let cand = |id: &str, x: f64| Candidate { id: CandidateId(id.into()), source_face: Some(4), point: [x, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    let mut p = policy(fixture.faces(), vec![cand("left", -6.0), cand("primary", 20.0)], 8, AutomaticRule::MatchCandidates { tol_mm: 0.03, min_dot: 0.95 });
    p.alternates = vec![(CandidateId("primary".into()), vec![cand("alt", 6.0)])];
    trace::take();
    let out = fixture.run(vec![contact("left", [-6.0, 20.0, 0.0], Origin::Auto), contact("auto-0", [20.0, 20.0, 0.0], Origin::Auto)], &s, &p, &never);
    let steps: Vec<&str> = trace::take().iter().map(|t| t.step).collect();
    assert_eq!(steps, ["alternates", "structures-off"], "{out:?}", out = (&out.dropped, &out.fallback, &out.verdict));
    assert_eq!(out.fallback, [Fallback::Brace], "only the structure that was on is reported");
    assert!(out.dropped.is_empty(), "{:?}", out.dropped);
    assert_eq!(out.contact_ids.len(), 2, "both contacts are kept: {:?}", out.contact_ids);
    assert!(!out.built.components.iter().any(|c| c.tag.part == Part::Brace));
    assert_eq!(out.verdict.status, Status::Clear, "{:?}", out.verdict);
}

/// D20: after Tree and Brace go off, an automatic contact whose own pillar now crosses (the tree had
/// carried it out of a slot narrower than the pillar) is left out alone; the others stay.
#[test]
fn after_structures_off_only_the_contacts_that_still_cross_are_left_out() {
    // As above, plus a pair under the shelf that a tree joins, one of them over a 0.6 mm slot.
    let fixture = Fixture::new(&[([-9.0, 20.0, -5.0], [32.0, 24.0, 5.0]), ([29.0, 0.0, -5.0], [31.0, 12.0, 5.0]), ([-0.4, 0.0, -5.0], [0.4, 19.0, 5.0]), ([10.5, 0.0, -5.0], [11.7, 12.0, 5.0]), ([12.3, 0.0, -5.0], [12.6, 12.0, 5.0])]);
    let s = settings(&[("trussEnabled", 1.0), ("raftEnabled", 0.0), ("scatterAutoTree", 1.0), ("lowPolyMode", 1.0), ("trussMinHeight", 1.0), ("trussDistanceLimit", 15.0)]);
    let cand = |id: &str, x: f64| Candidate { id: CandidateId(id.into()), source_face: Some(4), point: [x, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
    let mut p = policy(fixture.faces(), vec![cand("left", -6.0), cand("primary", 30.0), cand("c", 12.0), cand("d", 14.0)], 8, AutomaticRule::MatchCandidates { tol_mm: 0.03, min_dot: 0.95 });
    p.alternates = vec![(CandidateId("primary".into()), vec![cand("alt", 6.0)])];
    trace::take();
    let at = |id: &str, x: f64| contact(id, [x, 20.0, 0.0], Origin::Auto);
    let out = fixture.run(vec![at("left", -6.0), at("auto-0", 30.0), at("c", 12.0), at("d", 14.0)], &s, &p, &never);
    let steps: Vec<&str> = trace::take().iter().map(|t| t.step).collect();
    assert_eq!(steps.last(), Some(&"structures-off-leave-out"), "{steps:?}");
    assert_eq!(out.dropped, ["c"]);
    assert_eq!(out.contact_ids.len(), 3, "{:?}", out.contact_ids);
    assert_eq!(out.verdict.status, Status::Clear, "{:?}", out.verdict);
}


/// Three columns in a row under a shelf (x = -4, 0, 4): each neighbouring pair gets a two-segment
/// zigzag (one falling, one rising). A 0.3 mm wall stands between columns 1 and 2 at x = 2.
fn braced_row(wall: (f64, f64)) -> Generated {
    let fixture = Fixture::new(&[([-12.0, 20.0, -5.0], [12.0, 24.0, 5.0]), ([1.85, wall.0, -5.0], [2.15, wall.1, 5.0])]);
    let s = settings(&[("trussEnabled", 1.0), ("raftEnabled", 0.0), ("scatterAutoTree", 0.0), ("lowPolyMode", 1.0), ("trussMinHeight", 1.0)]);
    let at = |id: &str, x: f64| contact(id, [x, 20.0, 0.0], Origin::Auto);
    trace::take();
    fixture.run(vec![at("a", -4.0), at("b", 0.0), at("c", 4.0)], &s, &policy(fixture.faces(), Vec::new(), 8, AutomaticRule::AsGiven), &never)
}

fn brace_keys(out: &Generated) -> Vec<BraceKey> {
    let mut keys: Vec<BraceKey> = out.built.components.iter().filter(|c| c.tag.part == Part::Brace).map(|c| c.tag.brace.expect("every brace names its segment")).collect();
    keys.sort();
    keys
}

/// Pair 1-2 is columns b and c; its falling segment passes the wall at 5.2 mm, its rising one at 11.2 mm.
const FALLING_1_2: BraceKey = [0, 720, 0, 400, 320, 0];
const OTHERS: [BraceKey; 3] = [[-400, 720, 0, 0, 320, 0], [-400, 920, 0, 0, 1320, 0], [0, 920, 0, 400, 1320, 0]];

/// D24: only the segment that crosses is left out; its partners and the other pair's zigzag stay.
#[test]
fn a_brace_segment_that_crosses_is_pruned_and_every_other_segment_stays() {
    let out = braced_row((4.0, 6.5));
    let keys = brace_keys(&out);
    assert!(!keys.contains(&FALLING_1_2), "{keys:?}");
    assert_eq!(keys, { let mut all = OTHERS.to_vec(); all.sort(); all });
    assert_eq!(out.fallback, [Fallback::BracePruned]);
    assert_eq!((out.trials, trace::take().iter().map(|t| t.step).collect::<Vec<_>>()), (1, vec!["brace-prune"]));
    assert_eq!(out.verdict.status, Status::Clear, "{:?}", out.verdict);
    assert_eq!(out.contact_ids.len(), 3);
}

/// D24: the wall crosses every segment of pair 1-2. They are all pruned in one pass; the other pair
/// stays, and the braces are not switched off (nothing crosses after the pass).
#[test]
fn a_wall_across_a_whole_pair_prunes_that_pair_and_keeps_the_other() {
    let out = braced_row((3.0, 14.0));
    assert_eq!(brace_keys(&out), vec![OTHERS[0], OTHERS[1]]);
    assert_eq!(out.fallback, [Fallback::BracePruned]);
    assert_eq!((out.trials, trace::take().iter().map(|t| t.step).collect::<Vec<_>>()), (1, vec!["brace-prune"]));
    assert_eq!(out.verdict.status, Status::Clear, "{:?}", out.verdict);
}

#[test]
fn brace_pruning_is_deterministic() {
    let first = braced_row((4.0, 6.5));
    let (first_keys, first_print) = (brace_keys(&first), fingerprint(&first));
    let second = braced_row((4.0, 6.5));
    assert_eq!(first_keys, brace_keys(&second));
    assert_eq!(first_print, fingerprint(&second));
}
