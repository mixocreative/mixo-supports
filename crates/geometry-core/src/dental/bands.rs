//! The face graph, and the diagnostic surface strips on both sides of each contour (review layers).
//! The broad face cut only labels the two sides; it does not decide which side is non-fitting or
//! allow any contact. The strips are thresholds of `field::side_distances`.

use super::field::side_distances;
use super::incidence::inspect_contour_incidence;
use super::mesh::Mesh;
use std::collections::HashMap;

/// Face adjacency with f32 centroids (the oracle stores them as `Float32Array`).
pub struct FaceGraph {
    pub centroids: Vec<f32>,
    pub neighbors: Vec<i32>,
}

/// `None` when an edge has more than two faces, or (with `closed`) fewer than two.
pub fn face_graph(mesh: &Mesh, closed: bool) -> Option<FaceGraph> {
    let faces = mesh.face_count();
    let vertex_count = mesh.vertex_count() as u64;
    let mut centroids = vec![0f32; faces * 3];
    let mut neighbors = vec![-1i32; faces * 3];
    let mut first: HashMap<u64, (usize, usize, u8)> = HashMap::new();
    for face in 0..faces {
        let ids = [mesh.corner(face, 0), mesh.corner(face, 1), mesh.corner(face, 2)];
        for axis in 0..3 {
            let sum = f64::from(mesh.positions[ids[0] as usize * 3 + axis]) + f64::from(mesh.positions[ids[1] as usize * 3 + axis]) + f64::from(mesh.positions[ids[2] as usize * 3 + axis]);
            centroids[face * 3 + axis] = (sum / 3.0) as f32;
        }
        for corner in 0..3 {
            let (a, b) = (ids[corner], ids[(corner + 1) % 3]);
            let key = u64::from(a.min(b)) * vertex_count + u64::from(a.max(b));
            match first.get_mut(&key) {
                Some(prior) => {
                    if prior.2 != 1 {
                        return None;
                    }
                    prior.2 = 2;
                    neighbors[face * 3 + corner] = prior.0 as i32;
                    neighbors[prior.0 * 3 + prior.1] = face as i32;
                }
                None => {
                    first.insert(key, (face, corner, 1));
                }
            }
        }
    }
    if closed && first.values().any(|edge| edge.2 != 2) {
        return None;
    }
    Some(FaceGraph { centroids, neighbors })
}

pub struct Bands {
    pub outer_opening_side: Vec<u8>,
    pub outer_other_side: Vec<u8>,
    pub inner_opening_side: Vec<u8>,
    pub inner_other_side: Vec<u8>,
}

/// Why a band could not be made (the oracle's reason strings).
pub fn diagnostic_side_bands(mesh: &Mesh, allowed_faces: &[u8], outer: &[u32], opening: &[u32], setback: f64, width: f64) -> Result<Bands, &'static str> {
    if !setback.is_finite() || !width.is_finite() || setback < 0.0 || width <= setback || allowed_faces.len() != mesh.face_count() {
        return Err("invalid-band-input");
    }
    let graph = face_graph(mesh, true).ok_or("invalid-face-graph")?;
    let strip = |distances: Vec<f64>| distances.iter().map(|&d| u8::from(d >= setback && d <= width)).collect::<Vec<u8>>();
    let mut bands: Vec<Vec<u8>> = Vec::new();
    for contour in [outer, opening] {
        let pairs = inspect_contour_incidence(mesh.vertex_count(), mesh.indices, contour).map_err(|_| "invalid-contour")?;
        for pair in pairs.chunks_exact(2) {
            if allowed_faces[pair[0] as usize] == allowed_faces[pair[1] as usize] {
                return Err("contour-sides-not-separated");
            }
        }
        bands.push(strip(side_distances(&graph, mesh, contour, &pairs, allowed_faces, 1, width)));
        bands.push(strip(side_distances(&graph, mesh, contour, &pairs, allowed_faces, 0, width)));
    }
    let mut take = bands.into_iter();
    Ok(Bands {
        outer_opening_side: take.next().expect("band"),
        outer_other_side: take.next().expect("band"),
        inner_opening_side: take.next().expect("band"),
        inner_other_side: take.next().expect("band"),
    })
}
