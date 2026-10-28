//! Step F done checks on the reference aligner: the stable band and the pick.

use mixo_geometry_core::core::stl::BinaryStlStream;
use mixo_geometry_core::dental::mesh::Mesh;
use mixo_geometry_core::dental::profiles::reference_aligner;
use mixo_geometry_core::dental::tilt::{PickReason, RULES, Rule, ScanArgs, tilt_scan};

fn reference() -> (Vec<f32>, Vec<u32>) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/dental-reference/reference-aligner.stl");
    let bytes = std::fs::read(path).expect("reference aligner");
    let triangles = u32::from_le_bytes(bytes[80..84].try_into().unwrap());
    let mut stream = BinaryStlStream::new(triangles).unwrap();
    stream.push(&bytes).unwrap();
    let mesh = stream.finish().unwrap();
    (mesh.positions, mesh.indices)
}

fn scan(braced: bool) -> mixo_geometry_core::dental::tilt::TiltScan {
    let (positions, indices) = reference();
    let mesh = Mesh::new(&positions, &indices);
    let start = std::time::Instant::now();
    let scan = tilt_scan(&mesh, reference_aligner(), &ScanArgs { neck_length_mm: 2.0, pillar_diameter_mm: 1.4, lift_mm: 3.5, braced }).expect("scan");
    eprintln!("tilt scan (braced {braced}): {:?}", start.elapsed());
    for (at, row) in scan.rows.iter().enumerate() {
        let failed: Vec<String> = RULES.iter().filter(|r| row.failed(**r)).map(|r| format!("{r:?}:{:?}", row.failing[*r as usize].as_ref().unwrap())).collect();
        eprintln!("{:6.2} robust={} fit={} gap={:.2} slender={:.2} layer={:.1} height={:.2} {:?}", row.tilt_deg, scan.robust[at], row.fitting_side_tips, row.largest_gap_mm, row.largest_slenderness, row.largest_layer_mm2, row.height_mm, failed);
    }
    scan
}

fn tilt(scan: &mixo_geometry_core::dental::tilt::TiltScan, at: usize) -> f64 {
    (scan.rows[at].tilt_deg * 100.0).round() / 100.0
}

/// The measured reference values (docs/ROADMAP.md F, D15): neck 2 mm, pillar 1.4 mm, lift 3.5 mm.
#[test]
fn reference_scan_reports_the_stable_band_and_the_pick() {
    for (braced, band, pick) in [(true, (26.46, 44.46), 44.46), (false, (26.46, 36.46), 36.46)] {
        let scan = scan(braced);
        assert_eq!(scan.reason, PickReason::Robust);
        let (first, last) = scan.band.expect("a stable band");
        assert_eq!((tilt(&scan, first), tilt(&scan, last)), band, "braced {braced}");
        assert_eq!(tilt(&scan, scan.order[0]), pick, "braced {braced}");
        let first_failing = |rule: Rule| scan.rows.iter().position(|r| r.failed(rule)).map(|at| tilt(&scan, at));
        assert_eq!(first_failing(Rule::Crossing), Some(47.46));
        assert_eq!(first_failing(Rule::Cup), Some(48.46));
        assert_eq!(first_failing(Rule::Gap), None);
        assert!(scan.rows.iter().filter(|r| r.tilt_deg < 35.0).all(|r| r.passes()), "no failure below 35 degrees");
    }
}
