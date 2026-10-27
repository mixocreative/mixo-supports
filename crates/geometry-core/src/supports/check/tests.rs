use super::*;

fn push(positions: &mut Vec<f32>, p: [f64; 3]) -> u32 {
    positions.extend(p.map(|v| v as f32));
    (positions.len() / 3 - 1) as u32
}

/// A size³ box with its underside at y = bottom, the bottom face split into a fine grid.
fn boxed(size: f64, bottom: f64, grid: usize) -> (Vec<f32>, Vec<u32>) {
    let mut positions: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let h = size / 2.0;
    let mut id: Vec<Vec<u32>> = Vec::new();
    for i in 0..=grid {
        id.push(Vec::new());
        for j in 0..=grid {
            let p = push(&mut positions, [-h + size * i as f64 / grid as f64, bottom, -h + size * j as f64 / grid as f64]);
            id[i].push(p);
        }
    }
    for i in 0..grid {
        for j in 0..grid {
            let (a, b, c, d) = (id[i][j], id[i + 1][j], id[i + 1][j + 1], id[i][j + 1]);
            indices.extend([a, b, c, a, c, d]);
        }
    }
    let corners = [id[0][0], id[grid][0], id[grid][grid], id[0][grid]];
    let mut top = Vec::new();
    for &c in &corners {
        let (x, z) = (f64::from(positions[c as usize * 3]), f64::from(positions[c as usize * 3 + 2]));
        top.push(push(&mut positions, [x, bottom + size, z]));
    }
    indices.extend([top[0], top[2], top[1], top[0], top[3], top[2]]);
    for k in 0..4 {
        let (a, b) = (corners[k], corners[(k + 1) % 4]);
        let (c, d) = (top[(k + 1) % 4], top[k]);
        indices.extend([a, d, c, a, c, b]);
    }
    (positions, indices)
}

const SETTINGS: CheckSettings = CheckSettings { overhang_angle_degrees: 45.0, spacing: 2.0 };

fn lattice(keep: &dyn Fn(f64, f64) -> bool) -> Vec<V3> {
    let mut contacts = Vec::new();
    let mut x = -4.0;
    while x <= 4.0 {
        let mut z = -4.0;
        while z <= 4.0 {
            if keep(x, z) {
                contacts.push([x, 5.0, z]);
            }
            z += 2.0;
        }
        x += 2.0;
    }
    contacts
}

#[test]
fn reports_the_whole_underside_of_an_unsupported_box() {
    let (p, i) = boxed(10.0, 5.0, 10);
    let problems = check_supports(&p, &i, &[], &SETTINGS);
    assert!(!problems.is_empty());
    assert!(problems.iter().any(|q| q.kind == ProblemKind::Island));
    assert!(problems.iter().map(|q| q.area).sum::<f64>() > 80.0);
    assert!(problems.iter().all(|q| (q.position[1] - 5.0).abs() < 1e-5));
}

#[test]
fn finds_nothing_when_contacts_cover_the_underside() {
    let (p, i) = boxed(10.0, 5.0, 10);
    assert!(check_supports(&p, &i, &lattice(&|_, _| true), &SETTINGS).is_empty());
}

#[test]
fn points_at_the_uncovered_corner_when_one_contact_is_missing() {
    let (p, i) = boxed(10.0, 5.0, 10);
    let problems = check_supports(&p, &i, &lattice(&|x, z| x < 2.0 || z < 2.0), &SETTINGS);
    assert!(!problems.is_empty());
    assert!(problems.iter().all(|q| q.position[0] > 2.0 && q.position[2] > 2.0));
}

#[test]
fn flags_a_lone_downward_point_as_an_island_with_the_faces_around_it_covered() {
    let (mut p, i) = boxed(10.0, 5.0, 10);
    let centre = 5 * 11 + 5;
    p[centre * 3 + 1] = 4.0;
    let problems = check_supports(&p, &i, &lattice(&|x, z| x.hypot(z) > 3.0), &SETTINGS);
    let islands: Vec<_> = problems.iter().filter(|q| q.kind == ProblemKind::Island).collect();
    assert_eq!(islands.len(), 1);
    assert_eq!(islands[0].position, [0.0, 4.0, 0.0]);
}
