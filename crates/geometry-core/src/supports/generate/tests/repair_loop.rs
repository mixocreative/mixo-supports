use super::super::repair::trace;
use super::*;

/// What the repair did, as one comparable line: the trials by step (and contacts touched), the
/// outcome lists and a hash of the built positions. The expected lines were recorded from the loop
/// before it kept one result per query per build, so a repair that reaches the same result by the
/// same trials in the same order passes, and anything else fails.
fn fingerprint(out: &Generated) -> String {
    let log = trace::take();
    assert!(log.iter().all(|t| t.build_ms >= 0.0 && t.check_ms >= 0.0), "{log:?}");
    let steps: Vec<String> = log.iter().map(|t| format!("{}:{}{}", t.step, t.touched, if t.same { ":same" } else { "" })).collect();
    let hash = out.built.positions.iter().fold(0xcbf29ce484222325u64, |h, p| (h ^ u64::from(p.to_bits())).wrapping_mul(0x100000001b3));
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
    r#"trials=1 steps=["reaim-normal:1"] dropped=[] fallback=[] ids=["auto-0"] verdict=Clear positions=168:f98baab8b753253e"#,
    r#"trials=2 steps=["reaim-normal:1", "leave-out:1"] dropped=["auto-0"] fallback=[] ids=["hand"] verdict=Blocked positions=138:10942e1373d5e880"#,
    r#"trials=3 steps=["reaim-normal:1", "reaim-down:1", "leave-out:1"] dropped=["auto-0"] fallback=[] ids=["hand"] verdict=Clear positions=102:ca3d46b34a88b6b4"#,
    r#"trials=1 steps=["alternates:1"] dropped=[] fallback=[] ids=["auto-400_2000_0"] verdict=Clear positions=168:792419d77bd441af"#,
];
