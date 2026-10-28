use super::*;

/// A grid of `n` x `n` unit quads in the XY plane at z = 0, counter-clockwise seen from +Z.
fn grid(n: usize) -> (Vec<f32>, Vec<u32>) {
    let mut p = Vec::new();
    for y in 0..=n {
        for x in 0..=n {
            p.extend_from_slice(&[x as f32, y as f32, 0.0]);
        }
    }
    let mut i = Vec::new();
    for y in 0..n {
        for x in 0..n {
            let a = (y * (n + 1) + x) as u32;
            let (b, c, d) = (a + 1, a + n as u32 + 1, a + n as u32 + 2);
            i.extend_from_slice(&[a, b, d, a, d, c]);
        }
    }
    (p, i)
}

#[test]
fn column_faces_cover_every_face_a_vertical_ray_can_hit() {
    let (p, i) = grid(10);
    let bvh = Bvh::build(&p, &i);
    let mut faces = Vec::new();
    bvh.column_faces(3.7, 0.0, &mut faces);
    // The grid stands in the z = 0 plane: a vertical line at x = 3.7 crosses column 3 of every row.
    assert!((0..10).all(|row| faces.contains(&((row * 10 + 3) * 2))));
    faces.clear();
    bvh.column_faces(3.7, 5.0, &mut faces);
    assert!(faces.is_empty());
    let mut none = Vec::new();
    bvh.column_faces(50.0, 0.0, &mut none);
    assert!(none.is_empty());
}

#[test]
fn flat_round_trip_gives_identical_picks_and_refuses_damaged_indexes() {
    // A ribbon of 200 triangles so the tree has internal nodes.
    let mut positions = Vec::new();
    let mut indices = Vec::new();
    for k in 0..100u32 {
        let x = k as f32;
        positions.extend_from_slice(&[x, 0.0, 0.0, x + 1.0, 0.0, 0.0, x, 1.0, 0.0, x + 1.0, 1.0, 0.0]);
        indices.extend_from_slice(&[k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 1, k * 4 + 3, k * 4 + 2]);
    }
    let built = Bvh::build(&positions, &indices);
    let flat = built.to_flat();
    let loaded = Bvh::from_flat(flat.clone(), indices.len() / 3).expect("a valid index loads");
    assert_eq!(loaded.to_flat(), flat);
    for k in 0..300 {
        let origin = [(k as f64) * 0.37 % 101.0, (k as f64) * 0.13 % 1.2, 5.0];
        for side in [Side::Front, Side::Back, Side::Double] {
            let a = built.raycast_first(&positions, &indices, origin, [0.0, 0.0, -1.0], 0.0, f64::INFINITY, side);
            let b = loaded.raycast_first(&positions, &indices, origin, [0.0, 0.0, -1.0], 0.0, f64::INFINITY, side);
            assert_eq!(a, b);
        }
    }
    let faces = indices.len() / 3;
    assert!(Bvh::from_flat(flat.clone(), faces + 1).is_none(), "wrong triangle count");
    let mut repeated = flat.clone();
    repeated.order[1] = repeated.order[0];
    assert!(Bvh::from_flat(repeated, faces).is_none(), "not a permutation");
    let mut cyclic = flat.clone();
    cyclic.links[0] = 0;
    assert!(Bvh::from_flat(cyclic, faces).is_none(), "child before parent");
    let mut past_end = flat.clone();
    let last = past_end.links.len() - 2;
    past_end.links[last] = faces as u32;
    past_end.links[last + 1] = 5;
    assert!(Bvh::from_flat(past_end, faces).is_none(), "leaf outside the order");
    assert!(Bvh::from_flat(FlatBvh { bounds: vec![], links: vec![], order: vec![] }, 0).is_some());
}

#[test]
fn finds_the_face_under_a_ray_and_respects_sides() {
    let (p, i) = grid(10);
    let bvh = Bvh::build(&p, &i);
    // From +Z looking down: the triangle faces the ray (front).
    let hit = bvh.raycast_first(&p, &i, [3.7, 2.2, 5.0], [0.0, 0.0, -1.0], 0.0, 100.0, Side::Front).unwrap();
    assert!((hit.distance - 5.0).abs() < 1e-12);
    let (x, y) = (3, 2);
    assert_eq!(hit.face / 2, (y * 10 + x) as u32);
    // From below, Front misses, Back and Double hit.
    let below = [3.7, 2.2, -5.0];
    let up = [0.0, 0.0, 1.0];
    assert!(bvh.raycast_first(&p, &i, below, up, 0.0, 100.0, Side::Front).is_none());
    assert!(bvh.raycast_first(&p, &i, below, up, 0.0, 100.0, Side::Back).is_some());
    assert!(bvh.raycast_first(&p, &i, below, up, 0.0, 100.0, Side::Double).is_some());
    assert!(bvh.raycast_first(&p, &i, [3.7, 2.2, 5.0], [0.0, 0.0, -1.0], 0.0, 4.0, Side::Front).is_none());
}

#[test]
fn bvh_matches_brute_force_on_many_rays() {
    let (p, i) = grid(24);
    let bvh = Bvh::build(&p, &i);
    for k in 0..400 {
        let (u, v) = ((k * 37 % 240) as f64 / 10.0 + 0.013, (k * 91 % 240) as f64 / 10.0 + 0.007);
        let dir = [(k % 7) as f64 * 0.05 - 0.1, (k % 5) as f64 * 0.04 - 0.08, -1.0];
        let o = [u, v, 3.0];
        let fast = bvh.raycast_first(&p, &i, o, dir, 0.0, 50.0, Side::Double).map(|h| h.face);
        let slow = (0..(i.len() / 3) as u32)
            .filter_map(|f| {
                let [a, b, c] = triangle(&p, &i, f);
                intersect_triangle(o, dir, a, b, c, Side::Double).filter(|t| *t <= 50.0).map(|t| (t, f))
            })
            .min_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)))
            .map(|(_, f)| f);
        assert_eq!(fast, slow, "ray {k}");
    }
}

#[test]
fn empty_mesh_has_no_hits() {
    let bvh = Bvh::build(&[], &[]);
    assert!(bvh.raycast_first(&[], &[], [0.0; 3], [0.0, 0.0, 1.0], 0.0, 1.0, Side::Double).is_none());
}
