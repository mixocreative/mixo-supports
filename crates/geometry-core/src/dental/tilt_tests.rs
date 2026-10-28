use super::*;

fn row(step: i32, failing: [Option<Failing>; 4], fitting_side_tips: usize) -> TiltRow {
    TiltRow { tilt_deg: 40.0 + f64::from(step), step, rotation: [0.0; 3], failing, fitting_side_tips, largest_gap_mm: 0.0, largest_slenderness: 0.0, largest_layer_mm2: 0.0, height_mm: 0.0 }
}

/// Robust needs both tilts at the margin to pass; the band is the robust run around the pick;
/// exact ties go to the lower tilt.
#[test]
fn the_pick_prefers_robust_tilts_and_ties_go_to_the_lower_tilt() {
    let gap = || Some(Failing::Tip("dental-outer-0".into()));
    let rows: Vec<TiltRow> = (-4..=4).map(|s| row(s, if s == 4 { [None, gap(), None, None] } else { Default::default() }, 1)).collect();
    let (order, robust, reason) = pick_order(&rows, 2);
    assert_eq!(reason, PickReason::Robust);
    assert_eq!(robust, vec![false, false, true, true, true, true, false, false, false]);
    assert_eq!(rows[order[0]].step, 0);
    assert_eq!(stable_band(&robust, order[0]), Some((2, 5)));
    let tied: Vec<TiltRow> = [-1, 1].iter().map(|&s| row(s, Default::default(), 1)).collect();
    assert_eq!(tied[pick_order(&tied, 0).0[0]].step, -1);
}

/// A grid of `n` x `n` 1 mm cells on z = f(x, y), triangulated consistently (normals +z).
fn grid(n: u32, height: impl Fn(f32, f32) -> f32) -> (Vec<f32>, Vec<u32>) {
    let id = |i: u32, j: u32| j * (n + 1) + i;
    let positions = (0..=n).flat_map(|j| (0..=n).flat_map(move |i| [i as f32, j as f32, 0.0])).collect::<Vec<f32>>();
    let positions = positions.chunks_exact(3).flat_map(|p| [p[0], p[1], height(p[0], p[1])]).collect();
    let mut indices = Vec::new();
    for j in 0..n {
        for i in 0..n {
            indices.extend([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1)]);
        }
    }
    (positions, indices)
}

/// A slope rising 0.5 mm per mm along x with a pit `depth` mm deep at (5, 5); the low edge x = 0
/// is permitted (the slope's own minima there are infinitely prominent).
fn first_cup_on_slope(depth: f32, pit_permitted: bool) -> Option<u32> {
    let (positions, indices) = grid(10, |x, y| 0.5 * x - if x == 5.0 && y == 5.0 { depth } else { 0.0 });
    let mesh = Mesh::new(&positions, &indices);
    let heights: Vec<f64> = (0..mesh.vertex_count() as u32).map(|v| mesh.point(v)[2]).collect();
    let pit = 5 * 11 + 5;
    let permitted: Vec<bool> = (0..mesh.vertex_count()).map(|v| v % 11 == 0 || (pit_permitted && v == pit)).collect();
    first_cup(&heights, &Adjacency::of(&mesh), &permitted, 1.5)
}

#[test]
fn a_cup_is_a_prominent_lowest_point_outside_the_permitted_area() {
    // Pit 2.5 mm below the slope: the way out rises 2.0 mm (to the x = 4 row), a resin trap.
    assert_eq!(first_cup_on_slope(2.5, false), Some(5 * 11 + 5));
    // 1.5 mm deep: it rises only 1.0 mm before reaching lower ground.
    assert_eq!(first_cup_on_slope(1.5, false), None);
    // A supported (permitted) pit is no trap.
    assert_eq!(first_cup_on_slope(2.5, true), None);
    // An unpermitted global minimum has infinite prominence.
    let (positions, indices) = grid(4, |x, _| x);
    let mesh = Mesh::new(&positions, &indices);
    let heights: Vec<f64> = (0..mesh.vertex_count() as u32).map(|v| mesh.point(v)[2]).collect();
    assert_eq!(first_cup(&heights, &Adjacency::of(&mesh), &vec![false; mesh.vertex_count()], 1.5), Some(0));
}

#[test]
fn a_rim_gap_fails_exactly_when_the_ring_check_asks_for_a_review() {
    // Perimeter 12, spacing 3: tips at 0, 3, 6, 9 leave 3 mm; one missing leaves 6 = 2 x spacing.
    assert_eq!(rim_gap(12.0, 3.0, &[0.0, 3.0, 6.0, 9.0]).unwrap(), (3.0, false));
    assert_eq!(rim_gap(12.0, 3.0, &[0.0, 6.0, 9.0]).unwrap(), (6.0, false));
    let (gap, fails) = rim_gap(12.0, 3.0, &[0.0, 6.1, 9.0]).unwrap();
    assert!((gap - 6.1).abs() < 1e-12 && fails);
    assert!(rim_gap(12.0, 3.0, &[]).unwrap().1, "a rim without tips");
}

#[test]
fn a_neck_or_pillar_ray_that_reaches_the_model_is_a_crossing() {
    // The tip's face: a downward-facing 4 x 4 mm square at z = 10 (indices wound for normal -z).
    let mut positions: Vec<f32> = vec![-2., -2., 10., 2., -2., 10., 2., 2., 10., -2., 2., 10.];
    let mut indices: Vec<u32> = vec![0, 2, 1, 0, 3, 2];
    let (up, axis) = ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0]);
    let tip = |positions: &[f32], indices: &[u32]| {
        let mesh = Mesh::new(positions, indices);
        let bvh = Bvh::build(positions, indices);
        tip_crosses(&bvh, &mesh, 0, [0.0, 0.0, 10.0], [0.0, 0.0, -1.0], up, axis, 2.0, 0.7)
    };
    assert!(!tip(&positions, &indices), "nothing below: the tip's own face is ignored");
    // A small ledge 5 mm lower, only under the ray at +0.7 mm along the tilt axis.
    positions.extend([0.5, -0.1, 5., 0.9, -0.1, 5., 0.9, 0.1, 5., 0.5, 0.1, 5.]);
    indices.extend([4, 5, 6, 4, 6, 7]);
    assert!(tip(&positions, &indices), "the first offset ray (along the tilt axis) hits the ledge");
    // A wall the neck itself runs into, 1 mm below the tip.
    let (mut wall_p, mut wall_i) = (positions[..12].to_vec(), indices[..6].to_vec());
    wall_p.extend([-1., -1., 9., 1., -1., 9., 1., 1., 9., -1., 1., 9.]);
    wall_i.extend([4, 5, 6, 4, 6, 7]);
    assert!(tip(&wall_p, &wall_i));
}

#[test]
fn slenderness_is_height_above_the_plate_per_pillar_diameter() {
    assert_eq!(slenderness(28.0, 1.4), 20.0);
    assert!(slenderness(28.1, 1.4) > 20.0);
}

#[test]
fn the_largest_layer_of_a_box_is_its_cross_section() {
    // A closed 10 x 10 x 4 mm box, outward normals: every slice is 100 mm².
    let positions: Vec<f32> = vec![0., 0., 0., 10., 0., 0., 10., 10., 0., 0., 10., 0., 0., 0., 4., 10., 0., 4., 10., 10., 4., 0., 10., 4.];
    let indices: Vec<u32> = vec![0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    let mesh = Mesh::new(&positions, &indices);
    let up = [0.0, 0.0, 1.0];
    let heights: Vec<f64> = (0..8).map(|v| mesh.point(v)[2]).collect();
    assert!((largest_layer(&mesh, &heights, up) - 100.0).abs() < 1e-9, "{}", largest_layer(&mesh, &heights, up));
}
