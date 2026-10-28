use super::*;

/// Orthographic-like clip matrix: x, y pass through scaled, w = 1 (looking down -Z).
fn flat() -> Matrix4 {
    [0.1, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, -0.01, 0.0, 0.0, 0.0, 0.0, 1.0]
}

fn one_body(a: [f32; 3], b: [f32; 3]) -> BodySegments {
    BodySegments { keys: vec![7], first: vec![0, 1], points: [a, b].concat() }
}

#[test]
fn circle_over_a_visible_body_hits_and_far_away_misses() {
    let bodies = one_body([0.0, 0.0, 0.0], [10.0, 0.0, 0.0]);
    let mk = |points: &'static [f64]| Stroke { matrix: flat(), width: 200.0, height: 200.0, eye: [0.0, 0.0, 50.0], radius: 8.0, points, start: 0, end: 1, want: None };
    // Body projects to x 100..200 at y 100.
    assert_eq!(project_brush(&bodies, &[], &mk(&[150.0, 104.0])), vec![0]);
    assert!(project_brush(&bodies, &[], &mk(&[150.0, 130.0])).is_empty());
    // A swept path from far away reaches it.
    assert_eq!(project_brush(&bodies, &[], &mk(&[150.0, 150.0, 150.0, 100.0])), vec![0]);
}

#[test]
fn model_in_front_hides_the_body() {
    let bodies = one_body([0.0, 0.0, 0.0], [10.0, 0.0, 0.0]);
    // A big triangle at z = 20 (between eye z = 50 and the body at z = 0), facing +Z.
    let positions = [-100.0f32, -100.0, 20.0, 100.0, -100.0, 20.0, 0.0, 100.0, 20.0];
    let indices = [0u32, 1, 2];
    let bvh = Bvh::build(&positions, &indices);
    let identity = super::super::matrix::placement_matrix([0.0; 3], [0.0; 3]);
    let occluder = Occluder { positions: &positions, indices: &indices, bvh: &bvh, to_local: identity, side: Side::Double };
    let stroke = Stroke { matrix: flat(), width: 200.0, height: 200.0, eye: [0.0, 0.0, 50.0], radius: 8.0, points: &[150.0, 100.0], start: 0, end: 1, want: None };
    assert!(project_brush(&bodies, &[occluder], &stroke).is_empty());
    assert_eq!(project_brush(&bodies, &[], &stroke), vec![0]);
}

#[test]
fn body_segments_reduce_a_part_to_its_axis_and_skip_contactless_parts() {
    // A column of two stacked triangles: top ring at y = 10, bottom ring at y = 0.
    let positions = [0.0f32, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 10.0, 0.0, 2.0, 10.0, 0.0];
    let indices = [0u32, 1, 2, 1, 3, 2];
    let b = body_segments(&positions, &indices, &[5, NO_CONTACT], &[0, 3], &[3, 3]);
    assert_eq!(b.keys, vec![5]);
    assert_eq!(b.first, vec![0, 1]);
    assert_eq!(b.points[1], 10.0);
    assert_eq!(b.points[4], 0.0);
}

#[test]
fn segment_behind_the_camera_projects_to_nan() {
    let m: Matrix4 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0];
    let out = project_bodies(&[0.0, 0.0, -5.0, 1.0, 0.0, -6.0], &m, 100.0, 100.0);
    assert!(out.iter().all(|v| v.is_nan()));
}

#[test]
fn visibility_cache_survives_steps_until_the_key_changes() {
    let mut cache = VisibilityCache::default();
    cache.reuse_for(7).insert(1, true);
    assert_eq!(cache.reuse_for(7).get(&1), Some(&true));
    assert!(cache.reuse_for(8).is_empty());
}
