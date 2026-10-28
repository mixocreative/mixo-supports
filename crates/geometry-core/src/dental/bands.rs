//! Diagnostic surface strips on both sides of each contour. The old broad face cut only labels
//! the two sides; it does not decide which side is non-fitting or allow any contact.

use super::incidence::inspect_contour_incidence;
use super::mesh::{Mesh, MinHeap};
use crate::core::jsnum::hypot3;
use std::collections::HashMap;

/// Face adjacency with f32 centroids (the oracle stores them as `Float32Array`).
pub struct FaceGraph {
    pub centroids: Vec<f32>,
    pub neighbors: Vec<i32>,
}

pub fn face_graph(mesh: &Mesh) -> Option<FaceGraph> {
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
    if first.values().any(|edge| edge.2 != 2) {
        return None;
    }
    Some(FaceGraph { centroids, neighbors })
}

fn centroid_distance(graph: &FaceGraph, a: usize, b: usize) -> f64 {
    let c = &graph.centroids;
    hypot3([f64::from(c[a * 3]) - f64::from(c[b * 3]), f64::from(c[a * 3 + 1]) - f64::from(c[b * 3 + 1]), f64::from(c[a * 3 + 2]) - f64::from(c[b * 3 + 2])])
}

/// Surface strip of faces on one `side` of a contour between `setback` and `width` of
/// path distance from it (centroid-to-centroid walk inside the side).
fn side_strip(graph: &FaceGraph, mesh: &Mesh, contour: &[u32], faces: &[u32], region: &[u8], side: u8, setback: f64, width: f64) -> Vec<u8> {
    let mut distances = vec![f64::INFINITY; region.len()];
    let mut heap: MinHeap<usize> = MinHeap::new();
    for at in (0..contour.len()).step_by(2) {
        let face = if region[faces[at] as usize] == side { faces[at] } else { faces[at + 1] } as usize;
        let (a, b) = (contour[at] as usize * 3, contour[at + 1] as usize * 3);
        let mid = |axis: usize| (f64::from(mesh.positions[a + axis]) + f64::from(mesh.positions[b + axis])) / 2.0;
        let initial = hypot3([
            f64::from(graph.centroids[face * 3]) - mid(0),
            f64::from(graph.centroids[face * 3 + 1]) - mid(1),
            f64::from(graph.centroids[face * 3 + 2]) - mid(2),
        ]);
        if initial < distances[face] {
            distances[face] = initial;
            heap.push(initial, face);
        }
    }
    let mut result = vec![0u8; region.len()];
    while let Some((distance, face)) = heap.pop() {
        if distance != distances[face] || distance > width {
            continue;
        }
        if distance >= setback {
            result[face] = 1;
        }
        for corner in 0..3 {
            let next = graph.neighbors[face * 3 + corner];
            if next < 0 || region[next as usize] != side {
                continue;
            }
            let next = next as usize;
            let next_distance = distance + centroid_distance(graph, face, next);
            if next_distance < distances[next] && next_distance <= width {
                distances[next] = next_distance;
                heap.push(next_distance, next);
            }
        }
    }
    result
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
    let graph = face_graph(mesh).ok_or("invalid-face-graph")?;
    let mut bands: Vec<Vec<u8>> = Vec::new();
    for contour in [outer, opening] {
        let pairs = inspect_contour_incidence(mesh.vertex_count(), mesh.indices, contour).map_err(|_| "invalid-contour")?;
        for pair in pairs.chunks_exact(2) {
            if allowed_faces[pair[0] as usize] == allowed_faces[pair[1] as usize] {
                return Err("contour-sides-not-separated");
            }
        }
        bands.push(side_strip(&graph, mesh, contour, &pairs, allowed_faces, 1, setback, width));
        bands.push(side_strip(&graph, mesh, contour, &pairs, allowed_faces, 0, setback, width));
    }
    let mut take = bands.into_iter();
    Ok(Bands {
        outer_opening_side: take.next().expect("band"),
        outer_other_side: take.next().expect("band"),
        inner_opening_side: take.next().expect("band"),
        inner_other_side: take.next().expect("band"),
    })
}
