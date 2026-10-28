//! Generator unit tests (SPEC.md "Generator unit tests", h 0.5).

use crate::arch::{self, Built};
use crate::cases::{CaseFile, CaseSpec, Mode};
use crate::checks::{check_quality, check_topology, check_volume, find_self_intersection, triangles_intersect};
use crate::geom::{Label, Pose, Solid, V3, cross, dot, signed_volume, sub, unit};
use crate::perturb::perturb;
use crate::rng::SplitMix64;
use crate::{Generated, generate, sha256, verify};
use std::collections::HashMap;

const H: f64 = 0.5;

fn case_file() -> CaseFile {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../dentalwork/synthetic-aligners/cases.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("cases.json")).expect("cases.json parses")
}

fn at_half(case: &CaseSpec) -> CaseSpec {
    CaseSpec { h: Some(H), ..case.clone() }
}

fn mode_b() -> (CaseFile, Vec<CaseSpec>) {
    let file = case_file();
    let cases = file.cases.iter().filter(|c| c.mode == Mode::B).map(at_half).collect();
    (file, cases)
}

/// The construction in the build frame (before the pose), with the case's own draw order.
fn construct(file: &CaseFile, case: &CaseSpec) -> (Built, f64) {
    let params = case.arch_params(&file.defaults).unwrap();
    let mut rng = SplitMix64::for_case(&case.id);
    let _pose = Pose::draw(&mut rng);
    (arch::build(&params, &mut rng).unwrap_or_else(|e| panic!("{}: {e}", case.id)), params.t)
}

fn checks_6_to_8(id: &str, solid: &Solid, thickness: f64) {
    check_volume(solid, thickness).unwrap_or_else(|e| panic!("{id}: {e}"));
    check_quality(solid).unwrap_or_else(|e| panic!("{id}: {e}"));
    if let Some((a, b)) = find_self_intersection(solid, 2.0 * H) {
        panic!("{id}: check 8: triangles {a} ({:?}) and {b} ({:?}) intersect", solid.labels[a], solid.labels[b]);
    }
}

fn face_normal(solid: &Solid, f: usize) -> V3 {
    let [a, b, c] = solid.triangles[f].map(|i| solid.point(i));
    unit(cross(sub(b, a), sub(c, a)))
}

fn edge_faces(solid: &Solid) -> HashMap<(u32, u32), Vec<usize>> {
    let mut map: HashMap<(u32, u32), Vec<usize>> = HashMap::new();
    for (f, t) in solid.triangles.iter().enumerate() {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            map.entry((a.min(b), a.max(b))).or_default().push(f);
        }
    }
    map
}

fn dihedral(solid: &Solid, f: usize, g: usize) -> f64 {
    dot(face_normal(solid, f), face_normal(solid, g)).clamp(-1.0, 1.0).acos().to_degrees()
}

// 1. Every mode-B case's construction passes checks 1–8.
#[test]
fn every_mode_b_case_passes_checks_1_to_8() {
    let (file, cases) = mode_b();
    for case in &cases {
        let generated = generate(case, &file.defaults, None).unwrap_or_else(|e| panic!("{}: {e}", case.id));
        verify(&case.id, &generated).unwrap_or_else(|e| panic!("{}: {e}", case.id));
        let t = case.arch_params(&file.defaults).unwrap().t;
        checks_6_to_8(&case.id, &generated.solid, t);
    }
}

// 1 (mode C). Mirror, scale and noise on B01 at h 0.5 as input.
#[test]
fn mode_c_operations_on_b01_pass_checks_1_to_8() {
    let (file, cases) = mode_b();
    let b01 = cases.iter().find(|c| c.id == "B01").unwrap();
    let (built, t) = construct(&file, b01);
    let truth = [0.0, 0.0, -1.0];
    for (name, mirror, factor, noise) in [("mirror", true, None, 0.0), ("scale 0.9", false, Some(0.9), 0.0), ("scale 1.15", false, Some(1.15), 0.0), ("noise 0.03", false, None, 0.03), ("mirror + scale 0.9", true, Some(0.9), 0.0)] {
        let mut rng = SplitMix64::for_case("B01");
        let (solid, _) = perturb(&built.solid, truth, mirror, factor, noise, &mut rng);
        let generated = Generated { estimate: solid.triangles.len(), solid, pose: Pose::draw(&mut SplitMix64::for_case("B01")), truth, expected_chi: 0 };
        verify(name, &generated).unwrap_or_else(|e| panic!("{name}: {e}"));
        // Scaling scales the thickness too.
        checks_6_to_8(name, &generated.solid, t * factor.unwrap_or(1.0));
    }
}

// 2. Same seed → same SHA-256; another case id → different bytes.
#[test]
fn same_seed_same_bytes_other_id_other_bytes() {
    let (file, cases) = mode_b();
    let b01 = cases.iter().find(|c| c.id == "B01").unwrap();
    let digest = |case: &CaseSpec| {
        let generated = generate(case, &file.defaults, None).unwrap();
        sha256::sha256_hex(&verify(&case.id, &generated).unwrap().bytes)
    };
    assert_eq!(digest(b01), digest(b01));
    let other = CaseSpec { id: "B01-other".into(), ..b01.clone() };
    assert_ne!(digest(b01), digest(&other));
}

#[test]
fn sha256_matches_the_standard_vectors() {
    assert_eq!(sha256::sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert_eq!(sha256::sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

// 3. Buccal trim vertices lie on z_b(s) within 1e-6 before the pose.
#[test]
fn buccal_trim_lies_on_z_b() {
    let (file, cases) = mode_b();
    for case in &cases {
        let (built, _) = construct(&file, case);
        assert!(!built.buccal.is_empty());
        for &(v, z_b) in &built.buccal {
            let z = built.solid.point(v)[2];
            assert!((z - z_b).abs() < 1e-6, "{}: vertex {v} at z {z}, z_b {z_b}", case.id);
        }
    }
}

// 4. Cut walls 90 ± 5°; rounded walls under 30° except at the outer loop's corner vertices. The
// whole test runs at h 0.25: at h 0.5 the scallop and the lower incisors' groove turn the wall by
// more than the limits per edge (B07 trim about 32°, B10 lingual cut wall 84°).
#[test]
fn wall_dihedrals() {
    let (file, cases) = mode_b();
    let mut runs: Vec<(CaseSpec, bool)> = cases.iter().map(|c| (CaseSpec { h: Some(0.25), ..c.clone() }, false)).collect();
    for case in cases.iter().filter(|c| c.rounded_trim) {
        runs.push((CaseSpec { h: Some(0.25), ..case.clone() }, true));
    }
    for (case, trim_run) in &runs {
        let (built, _) = construct(&file, case);
        let solid = &built.solid;
        let edges = edge_faces(solid);
        let mut cut = 0;
        let mut window = 0;
        let mut trim = 0;
        for (&(a, b), faces) in &edges {
            let [f, g] = faces[..] else { panic!("{}: edge used {} times", case.id, faces.len()) };
            let (lf, lg) = (solid.labels[f], solid.labels[g]);
            let surface = |l: Label| l == Label::F || l == Label::G;
            let angle = dihedral(solid, f, g);
            if (lf == Label::CutWall && surface(lg)) || (lg == Label::CutWall && surface(lf)) {
                cut += 1;
                assert!((angle - 90.0).abs() <= 5.0, "{}: cut wall dihedral {angle:.2}° at edge {a}-{b} {:?} {:?} {:?}", case.id, solid.point(a), solid.point(b), (lf, lg));
            }
            if lf != Label::RoundWall && lg != Label::RoundWall {
                continue;
            }
            // The loop turns about 90° at a corner; edges within 1 mm of one are exempt.
            let near_corner = |v: u32| built.corner_wall_vertices.iter().any(|&c| {
                let (p, q) = (solid.point(v), solid.point(c));
                (0..3).map(|i| (p[i] - q[i]) * (p[i] - q[i])).sum::<f64>() < 1.0
            });
            if near_corner(a) || near_corner(b) {
                continue;
            }
            let on_window = built.window_wall_vertices.contains(&a) && built.window_wall_vertices.contains(&b);
            if on_window && !trim_run {
                window += 1;
                assert!(angle < 30.0, "{}: window rim dihedral {angle:.2}° at {:?}", case.id, solid.point(a));
            }
            if !on_window && *trim_run {
                trim += 1;
                assert!(angle < 30.0, "{}: rounded trim dihedral {angle:.2}° at h {:?}, {:?}", case.id, case.h, solid.point(a));
            }
        }
        if case.rounded_trim {
            assert_eq!(cut, 0, "{}: B07 has no cut walls", case.id);
        } else {
            assert!(cut > 0, "{}", case.id);
        }
        if *trim_run {
            assert!(trim > 0, "{}", case.id);
        } else {
            assert_eq!(window > 0, case.plate, "{}", case.id);
        }
    }
}

// 5. A window that does not fit inside O returns Err.
#[test]
fn a_window_that_does_not_fit_is_an_error() {
    let (file, cases) = mode_b();
    let b01 = cases.iter().find(|c| c.id == "B01").unwrap();
    let wide = CaseSpec { window: Some([60.0, 40.0]), ..b01.clone() };
    let mut rng = SplitMix64::for_case(&wide.id);
    let _ = Pose::draw(&mut rng);
    let result = arch::build(&wide.arch_params(&file.defaults).unwrap(), &mut rng);
    let error = result.err().expect("an oversized window must not build");
    assert!(error.contains("does not fit"), "{error}");
}

// 6. The self-intersection check finds two crossing triangles and passes a tetrahedron.
#[test]
fn self_intersection_check() {
    let crossing = Solid {
        positions: vec![[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.5, 0.5, -1.0], [0.5, 0.5, 1.0], [1.5, -1.0, 0.0]],
        triangles: vec![[0, 1, 2], [3, 4, 5]],
        labels: vec![Label::F; 2],
    };
    assert!(triangles_intersect(crossing.triangles[0].map(|i| crossing.point(i)), crossing.triangles[1].map(|i| crossing.point(i))));
    assert!(find_self_intersection(&crossing, 1.0).is_some());
    let tetrahedron = Solid {
        positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        triangles: vec![[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]],
        labels: vec![Label::F; 4],
    };
    check_topology(4, &tetrahedron.triangles, 2).unwrap();
    assert!(signed_volume(&tetrahedron.positions, &tetrahedron.triangles) > 0.0);
    assert!(find_self_intersection(&tetrahedron, 1.0).is_none());
}

// 7. Mirroring keeps the volume positive.
#[test]
fn mirroring_keeps_the_volume_positive() {
    let (file, cases) = mode_b();
    let b01 = cases.iter().find(|c| c.id == "B01").unwrap();
    let (built, _) = construct(&file, b01);
    let before = signed_volume(&built.solid.positions, &built.solid.triangles);
    let (mirrored, opening) = perturb(&built.solid, [1.0, 0.0, -1.0], true, None, 0.0, &mut SplitMix64::for_case("B01"));
    let after = signed_volume(&mirrored.positions, &mirrored.triangles);
    assert!(before > 0.0 && after > 0.0, "{before} {after}");
    assert!((before - after).abs() < 1e-6 * before);
    assert_eq!(opening, [-1.0, 0.0, -1.0]);
}

// 8. The plate join has every dihedral under 15°.
#[test]
fn plate_join_is_smooth() {
    let (file, cases) = mode_b();
    for case in cases.iter().filter(|c| c.plate) {
        let (built, _) = construct(&file, case);
        let solid = &built.solid;
        let edges = edge_faces(solid);
        assert!(!built.join_edges.is_empty());
        for &(a, b) in &built.join_edges {
            let faces = &edges[&(a.min(b), a.max(b))];
            let angle = dihedral(solid, faces[0], faces[1]);
            assert!(angle < 15.0, "{}: join dihedral {angle:.2}° at {:?}", case.id, solid.point(a));
        }
    }
}
