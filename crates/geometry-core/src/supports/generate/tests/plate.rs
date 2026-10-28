//! Lift as a plate offset: a build on the frame the supports were generated in, with the plate moved
//! down by the lift change, equals a fresh build with the model moved up instead, within float noise
//! (same topology, parts, contacts, verdicts and islands).

use super::*;
use crate::supports::build::Ground;

/// A slab over a pyramid (columns land on its slanted faces near the apex, where the remesh depends
/// on the voxel phase), two walls 0.6 mm apart (a pillar between them crosses and is repaired away)
/// and a floating box (an island). Lowest point at y = 2.
fn scene() -> (Vec<f32>, Vec<u32>) {
    let (mut positions, mut indices) = boxes(&[
        ([-10.0, 24.0, -10.0], [10.0, 26.0, 10.0]),
        ([6.0, 2.0, -3.0], [7.7, 20.0, 3.0]),
        ([8.3, 2.0, -3.0], [10.0, 20.0, 3.0]),
        ([14.0, 6.0, 14.0], [16.0, 8.0, 16.0]),
    ]);
    let base = positions.len() as u32 / 3;
    positions.extend([-3.0, 2.0, -3.0, 3.0, 2.0, -3.0, 3.0, 2.0, 3.0, -3.0, 2.0, 3.0, 0.3, 8.0, 0.2]);
    for f in [[0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0], [0, 1, 2], [0, 2, 3]] {
        indices.extend(f.map(|k| base + k));
    }
    (positions, indices)
}

fn scene_contacts(dy: f64) -> Vec<ColumnContact> {
    let mut out: Vec<ColumnContact> = [(-8.0, -8.0), (-7.4, -8.0), (-8.0, 8.0), (8.0, 8.0), (0.0, 0.0), (-1.0, 1.0), (8.0, 0.0), (0.0, -8.0), (0.0, 8.0)]
        .iter()
        .enumerate()
        .map(|(k, &(x, z))| contact(&format!("c{k}"), [x, 24.0 + dy, z], Origin::Auto))
        .collect();
    out.push(contact("island", [15.0, 6.0 + dy, 15.0], Origin::Auto));
    out.push(contact("hand", [-8.0, 24.0 + dy, 0.0], Origin::Manual));
    out
}

fn raised(positions: &[f32], dy: f64) -> Vec<f32> {
    positions.chunks_exact(3).flat_map(|p| [p[0], (f64::from(p[1]) + dy) as f32, p[2]]).collect()
}

fn run_at(positions: &[f32], indices: &[u32], dy: f64, s: &SupportSettings, mode: BuildMode, budget: u32) -> Generated {
    let bvh = Bvh::build(positions, indices);
    let model = Model::new(positions, indices, &bvh);
    let p = policy(indices.len() / 3, Vec::new(), budget, AutomaticRule::AsGiven);
    generate(GenerateInput { contacts: scene_contacts(dy), settings: s, mode, model: Some(&model), label_text: "AB", zones: &[], policy: &p, expired: &never, local: None }).unwrap()
}

fn close(a: f64, b: f64, what: &str) {
    assert!((a - b).abs() <= 1e-5, "{what}: {a} vs {b}");
}

fn close_point(a: V, b: V, dy: f64, what: &str) {
    close(a[0], b[0], what);
    close(a[1] + dy, b[1], what);
    close(a[2], b[2], what);
}

/// `moved` was built with the plate at -`dy`; `fresh` on the model raised by `dy`.
fn assert_same_build(moved: &Generated, fresh: &Generated, dy: f64) {
    assert_eq!(moved.built.indices, fresh.built.indices);
    assert_eq!(moved.built.positions.len(), fresh.built.positions.len());
    for (k, (a, b)) in moved.built.positions.chunks_exact(3).zip(fresh.built.positions.chunks_exact(3)).enumerate() {
        close_point([f64::from(a[0]), f64::from(a[1]), f64::from(a[2])], [f64::from(b[0]), f64::from(b[1]), f64::from(b[2])], dy, &format!("vertex {k}"));
    }
    assert_eq!(moved.built.components.len(), fresh.built.components.len());
    for (a, b) in moved.built.components.iter().zip(&fresh.built.components) {
        assert_eq!((a.start, a.count, a.tag.part, a.tag.contact, a.tag.origin, a.tag.structure_kind), (b.start, b.count, b.tag.part, b.tag.contact, b.tag.origin, b.tag.structure_kind));
        assert_eq!(a.tag.landing_reach.is_some(), b.tag.landing_reach.is_some());
        assert_eq!(a.tag.intents.len(), b.tag.intents.len());
        for (x, y) in a.tag.intents.iter().zip(&b.tag.intents) {
            assert_eq!((x.kind, x.contact, x.face), (y.kind, y.contact, y.face));
            close_point(x.point, y.point, dy, "intent");
        }
    }
    assert_eq!(moved.built.grounds.len(), fresh.built.grounds.len());
    for (a, b) in moved.built.grounds.iter().zip(&fresh.built.grounds) {
        match (a, b) {
            (Ground::Model { face: fa, point: pa, .. }, Ground::Model { face: fb, point: pb, .. }) => {
                assert_eq!(fa, fb);
                close_point(*pa, *pb, dy, "landing");
            }
            _ => assert_eq!(a, b),
        }
    }
    assert_eq!((&moved.contact_ids, &moved.dropped, &moved.dropped_by_zones), (&fresh.contact_ids, &fresh.dropped, &fresh.dropped_by_zones));
    assert_eq!((&moved.fallback, moved.trials), (&fresh.fallback, fresh.trials));
    assert_eq!(moved.verdict, fresh.verdict);
    match (&moved.islands, &fresh.islands) {
        (IslandVerdict::Ok(a), IslandVerdict::Ok(b)) => {
            assert_eq!(a.len(), b.len());
            for (x, y) in a.iter().zip(b) {
                assert_eq!((x.vertex, x.status, x.manual_only), (y.vertex, y.status, y.manual_only));
                close(x.height + dy, y.height, "island height");
            }
        }
        (a, b) => assert_eq!(a, b),
    }
}

fn parts(out: &Generated) -> Vec<Part> {
    let mut parts: Vec<Part> = out.built.components.iter().map(|c| c.tag.part).collect();
    parts.dedup();
    parts
}

/// Builds the scene with the plate moved down by `dy` and fresh on the model raised by `dy`, and
/// checks they agree; returns the moved-plate build.
fn check(overrides: &[(&str, f64)], mode: BuildMode, dy: f64, budget: u32) -> Generated {
    let (positions, indices) = scene();
    let base = settings(overrides);
    let mut moved_plate = base.clone();
    moved_plate.plate_y = -dy;
    let moved = run_at(&positions, &indices, 0.0, &moved_plate, mode, budget);
    let fresh = run_at(&raised(&positions, dy), &indices, dy, &base, mode, budget);
    assert_same_build(&moved, &fresh, dy);
    // The plate itself: the lowest foot or raft floor sits on it.
    let low = moved.built.positions.iter().skip(1).step_by(3).fold(f64::INFINITY, |m, &y| m.min(f64::from(y)));
    close(low, -dy, "plate");
    moved
}

fn lands_on_the_model(out: &Generated) -> bool {
    out.built.grounds.iter().any(|g| matches!(g, Ground::Model { .. }))
}

const FULL: [(&str, f64); 5] = [("lowPolyMode", 1.0), ("trussEnabled", 1.0), ("raftEnabled", 1.0), ("scatterAutoTree", 1.0), ("labelEnabled", 1.0)];

#[test]
fn a_moved_plate_builds_what_a_raised_model_builds() {
    for roof in [1.0, 2.0] {
        let mut overrides = FULL.to_vec();
        overrides.push(("roofMode", roof));
        for dy in [1.7, -0.9] {
            // Budget 0 reports every crossing and keeps the braces and the pedestal landings.
            let report = check(&overrides, BuildMode::Preview, dy, 0);
            let parts = parts(&report);
            for part in [Part::Raft, Part::Label, Part::Foot, Part::Pillar, Part::Brace, Part::Column] {
                assert!(parts.contains(&part), "{part:?} missing from {parts:?}");
            }
            assert!(lands_on_the_model(&report) && report.verdict.status == Status::Blocked);
            assert!(matches!(&report.islands, IslandVerdict::Ok(islands) if islands.len() >= 2));
            // The repair takes the same steps on both: braces off, the pillar between the walls left out.
            let repaired = check(&overrides, BuildMode::Preview, dy, 8);
            assert!(repaired.fallback.contains(&Fallback::Brace) && repaired.dropped.iter().any(|id| id == "c6"), "{:?} {:?}", repaired.fallback, repaired.dropped);
        }
    }
    // No raft: feet and the braces stand on the plate itself.
    let bare = check(&[("lowPolyMode", 1.0), ("trussEnabled", 1.0), ("raftEnabled", 0.0)], BuildMode::Preview, 2.5, 0);
    assert!(parts(&bare).contains(&Part::Brace));
}

/// With the voxel remesh (export, or a preview that is not Low Poly) neck normals and landings come
/// from a grid aligned to the build frame, so a fresh build on a raised model is not a translated
/// copy of the first one (the reference aligner's tips turn by up to 2 mm). A moved plate keeps the
/// generation frame: tips, necks and model landings stay exactly as generated; only what reaches the
/// plate changes.
#[test]
fn an_export_build_on_a_moved_plate_keeps_the_generated_tips_and_landings() {
    let (positions, indices) = scene();
    let s = settings(&[("raftEnabled", 1.0), ("labelEnabled", 1.0)]);
    let mut moved_plate = s.clone();
    moved_plate.plate_y = -1.7;
    let generated = run_at(&positions, &indices, 0.0, &s, BuildMode::Export, 0);
    let moved = run_at(&positions, &indices, 0.0, &moved_plate, BuildMode::Export, 0);
    assert!(lands_on_the_model(&moved));
    assert_eq!(moved.built.grounds, generated.built.grounds);
    let tips = |out: &Generated| -> Vec<Vec<f32>> {
        out.built.components.iter().filter(|c| matches!(c.tag.part, Part::Tip | Part::Neck)).map(|c| {
            out.built.indices[c.start as usize..(c.start + c.count) as usize].iter().flat_map(|&v| out.built.positions[v as usize * 3..v as usize * 3 + 3].to_vec()).collect()
        }).collect()
    };
    assert_eq!(tips(&moved), tips(&generated));
    let low = moved.built.positions.iter().skip(1).step_by(3).fold(f64::INFINITY, |m, &y| m.min(f64::from(y)));
    close(low, -1.7, "plate");
}
