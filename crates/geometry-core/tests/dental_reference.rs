//! U6a done checks on the canonical fixture (docs/dental-reference/reference-aligner.stl).

use mixo_geometry_core::core::stl::BinaryStlStream;
use mixo_geometry_core::dental::mesh::Mesh;
use mixo_geometry_core::dental::footprint::Tuning;
use mixo_geometry_core::dental::orientation::{OpeningState, Orientation, orient_dental};
use mixo_geometry_core::dental::policy::policy_from_region;
use mixo_geometry_core::dental::profiles::reference_aligner;
use mixo_geometry_core::dental::region::propose_region;

fn reference() -> (Vec<f32>, Vec<u32>) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/dental-reference/reference-aligner.stl");
    let bytes = std::fs::read(path).expect("reference aligner");
    let triangles = u32::from_le_bytes(bytes[80..84].try_into().unwrap());
    let mut stream = BinaryStlStream::new(triangles).unwrap();
    stream.push(&bytes).unwrap();
    let mesh = stream.finish().unwrap();
    (mesh.positions, mesh.indices)
}

#[test]
fn reference_region_matches_the_pinned_counts() {
    let (positions, indices) = reference();
    let mesh = Mesh::new(&positions, &indices);
    let profile = reference_aligner();
    let start = std::time::Instant::now();
    let region = propose_region(&mesh, &Tuning::defaults(profile), profile).expect("region");
    eprintln!("propose_region: {:?}", start.elapsed());
    assert_eq!(region.contours.outer_edges.len() / 2, 2665);
    assert_eq!(region.contours.opening_edges.len() / 2, 339);
    assert_eq!(region.region_faces, [254344, 119612]);
    assert_eq!(region.allowed_faces.iter().map(|&f| usize::from(f)).sum::<usize>(), 254344);
    assert!(region.contacts.len() > 70 && region.contacts.len() < 130, "{}", region.contacts.len());
    let policy = policy_from_region(&region, profile);
    assert_eq!(policy.result.candidates.len(), region.contacts.len());
    assert!(policy.result.candidates.iter().all(|c| policy.result.permitted_faces.get(c.source_face.unwrap() as usize)));
}

#[test]
fn reference_orients_with_a_present_opening() {
    let (positions, indices) = reference();
    let mesh = Mesh::new(&positions, &indices);
    match orient_dental(&mesh, reference_aligner()) {
        Orientation::Oriented { opening, mesh_ok, rotation, .. } => {
            assert_eq!(opening, OpeningState::Present);
            assert!(mesh_ok && rotation.is_some());
        }
        Orientation::Failed { reason, .. } => panic!("failed: {reason:?}"),
    }
}

#[test]
fn a_cube_abstains_and_a_malformed_mesh_fails() {
    let positions: [f32; 24] = [-1., -1., -1., 1., -1., -1., 1., 1., -1., -1., 1., -1., -1., -1., 1., 1., -1., 1., 1., 1., 1., -1., 1., 1.];
    let indices: [u32; 36] = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    let profile = reference_aligner();
    assert!(propose_region(&Mesh::new(&positions, &indices), &Tuning::defaults(profile), profile).is_err());
    let tiny = [0f32; 9];
    assert!(matches!(orient_dental(&Mesh::new(&tiny, &[0, 1, 2]), profile), Orientation::Failed { mesh_ok: false, .. }));
}
