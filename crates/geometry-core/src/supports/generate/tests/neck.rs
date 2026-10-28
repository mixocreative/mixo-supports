use super::*;

/// A shelf (underside y = 20, face 4 of the first box) and a block below and beside the contact.
/// A neck tilted 45 degrees toward +X runs into the block; one along the shelf's own normal
/// (straight down) passes it.
fn shelf_and_block(block: (V, V)) -> Fixture {
    Fixture::new(&[([-5.0, 20.0, -5.0], [5.0, 24.0, 5.0]), block])
}

fn tilted(id: &str, origin: Origin) -> ColumnContact {
    let mut c = contact(id, [0.0, 20.0, 0.0], origin);
    c.candidate.normal = [std::f64::consts::FRAC_1_SQRT_2, -std::f64::consts::FRAC_1_SQRT_2, 0.0];
    c
}

fn tilted_policy(fixture: &Fixture, budget: u32) -> PolicyResult {
    let candidate = Candidate { id: CandidateId("cand".into()), source_face: Some(4), ..tilted("cand", Origin::Auto).candidate };
    policy(fixture.faces(), vec![candidate], budget, AutomaticRule::MatchCandidates { tol_mm: 0.03, min_dot: 0.95 })
}

#[test]
fn a_crossing_neck_is_reaimed_along_its_face_normal_and_kept() {
    let fixture = shelf_and_block(([0.9, 15.0, -2.0], [3.0, 19.0, 2.0]));
    let out = fixture.run(vec![tilted("auto-0", Origin::Auto)], &plain_settings(&[]), &tilted_policy(&fixture, 8), &never);
    assert!(out.dropped.is_empty(), "{:?}", out.dropped);
    assert_eq!(out.contact_ids, vec!["auto-0"]);
    assert_eq!(out.verdict.status, Status::Clear, "{:?}", out.verdict);
    assert_eq!(out.trials, 1);
}

#[test]
fn a_reporting_policy_reports_a_crossing_neck_and_rebuilds_nothing() {
    let fixture = shelf_and_block(([0.9, 15.0, -2.0], [3.0, 19.0, 2.0]));
    let out = fixture.run(vec![tilted("auto-0", Origin::Auto)], &plain_settings(&[]), &tilted_policy(&fixture, 0), &never);
    assert_eq!(out.verdict.status, Status::Blocked);
    assert!(out.verdict.issues.iter().any(|i| i.blocked && i.part == Part::Neck && i.contact == Some(0)), "{:?}", out.verdict.issues);
    assert!(out.dropped.is_empty() && out.trials == 0);
}

#[test]
fn a_neck_that_crosses_after_every_aim_is_left_out_but_a_manual_one_only_reported() {
    // The block sits 0.5 mm under the contact: tilted or straight down, the neck runs into it.
    let fixture = shelf_and_block(([-3.0, 15.0, -3.0], [3.0, 19.5, 3.0]));
    let out = fixture.run(vec![tilted("auto-0", Origin::Auto), tilted("hand", Origin::Manual)], &plain_settings(&[]), &tilted_policy(&fixture, 8), &never);
    assert_eq!(ids(&out.dropped), vec!["auto-0"]);
    assert_eq!(out.contact_ids, vec!["hand"]);
    // The manual contact keeps its neck and its crossing is reported.
    assert_eq!(out.verdict.status, Status::Blocked);
    assert!(out.verdict.issues.iter().all(|i| out.contact_ids[i.contact.unwrap() as usize] == "hand"));
    assert!(out.trials >= 2 && out.trials <= 8, "{}", out.trials);
}
