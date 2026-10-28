//! Surface distance from each contour, signed by side, and the support area it bounds. One bounded
//! multi-source Dijkstra per contour side (3D centroid walk inside that side) gives every face its
//! distance from the contour; the operator's position and width then only threshold it. The field
//! is a function of the mesh, the two contours and the face cut, so it is kept across calls
//! (`cache::prepared`) and a retune does not walk the mesh again.

use super::bands::{FaceGraph, face_graph};
use super::incidence::inspect_contour_incidence;
use super::mesh::{Mesh, MinHeap};
use crate::core::jsnum::hypot3;
use std::collections::HashSet;

fn centroid_distance(graph: &FaceGraph, a: usize, b: usize) -> f64 {
    let c = &graph.centroids;
    hypot3([f64::from(c[a * 3]) - f64::from(c[b * 3]), f64::from(c[a * 3 + 1]) - f64::from(c[b * 3 + 1]), f64::from(c[a * 3 + 2]) - f64::from(c[b * 3 + 2])])
}

/// Path distance (mm) from the contour of every face on `side` of it, up to `reach` (farther and
/// other-side faces are infinite). Each contour edge seeds its incident face on `side` at the
/// centroid-to-edge-midpoint distance.
pub fn side_distances(graph: &FaceGraph, mesh: &Mesh, contour: &[u32], faces: &[u32], region: &[u8], side: u8, reach: f64) -> Vec<f64> {
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
    let mut done = vec![f64::INFINITY; region.len()];
    while let Some((distance, face)) = heap.pop() {
        if distance != distances[face] || distance > reach {
            continue;
        }
        done[face] = distance;
        for corner in 0..3 {
            let next = graph.neighbors[face * 3 + corner];
            if next < 0 || region[next as usize] != side {
                continue;
            }
            let next = next as usize;
            let next_distance = distance + centroid_distance(graph, face, next);
            if next_distance < distances[next] && next_distance <= reach {
                distances[next] = next_distance;
                heap.push(next_distance, next);
            }
        }
    }
    done
}

/// One contour with its incident face pairs and the signed distance of every face: positive on
/// the outer (non-fitting, region 0) side, negative across the edge (region 1), infinite beyond
/// the reach.
pub struct ContourField {
    pub pairs: Vec<u32>,
    pub signed: Vec<f64>,
    /// Face pairs `(min, max)` that share a contour edge: the sampler never walks across them.
    pub blocked: HashSet<(u32, u32)>,
}

impl ContourField {
    /// 1 per face whose signed distance lies in `[low, high]`.
    pub fn band(&self, low: f64, high: f64) -> Vec<u8> {
        self.signed.iter().map(|&s| u8::from(s.is_finite() && s >= low && s <= high)).collect()
    }
}

/// The face graph and both contour fields of one mesh and face cut.
pub struct Prepared {
    pub graph: FaceGraph,
    pub outer: ContourField,
    pub opening: ContourField,
}

/// How far the field is walked on each side: `[outer side, across the edge]` (mm).
pub type Reach = [f64; 2];

fn contour_field(graph: &FaceGraph, mesh: &Mesh, region: &[u8], contour: &[u32], reach: Reach) -> Result<ContourField, &'static str> {
    let pairs = inspect_contour_incidence(mesh.vertex_count(), mesh.indices, contour).map_err(|_| "invalid-contour")?;
    for pair in pairs.chunks_exact(2) {
        if region[pair[0] as usize] == region[pair[1] as usize] {
            return Err("contour-sides-not-separated");
        }
    }
    let outside = side_distances(graph, mesh, contour, &pairs, region, 0, reach[0]);
    let across = side_distances(graph, mesh, contour, &pairs, region, 1, reach[1]);
    let signed = outside.iter().zip(&across).map(|(&o, &a)| if o.is_finite() { o } else { -a }).collect();
    let blocked = pairs.chunks_exact(2).map(|p| (p[0].min(p[1]), p[0].max(p[1]))).collect();
    Ok(ContourField { pairs, signed, blocked })
}

/// Builds the graph and both fields. `Err` is the band reason string.
pub fn prepare(mesh: &Mesh, region: &[u8], outer: &[u32], opening: &[u32], reach: Reach) -> Result<Prepared, &'static str> {
    if region.len() != mesh.face_count() || reach.iter().any(|r| !r.is_finite() || *r < 0.0) {
        return Err("invalid-band-input");
    }
    let graph = face_graph(mesh, true).ok_or("invalid-face-graph")?;
    let outer = contour_field(&graph, mesh, region, outer, reach)?;
    let opening = contour_field(&graph, mesh, region, opening, reach)?;
    Ok(Prepared { graph, outer, opening })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A closed box-like strip: a 2 x N grid wrapped into a tube, the contour around its middle.
    fn tube() -> (Vec<f32>, Vec<u32>, Vec<u32>) {
        let (around, along) = (12u32, 9u32);
        let id = |i: u32, j: u32| j * around + (i % around);
        let mut positions = Vec::new();
        for j in 0..along {
            for i in 0..around {
                let a = i as f32 / around as f32 * std::f32::consts::TAU;
                positions.extend([a.cos() * 2.0, j as f32 * 0.25, a.sin() * 2.0]);
            }
        }
        // Caps keep it closed: one centre vertex at each end.
        let (bottom, top) = (around * along, around * along + 1);
        positions.extend([0.0, 0.0, 0.0, 0.0, (along - 1) as f32 * 0.25, 0.0]);
        let mut indices = Vec::new();
        for j in 0..along - 1 {
            for i in 0..around {
                indices.extend([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i + 1, j)]);
            }
        }
        for i in 0..around {
            indices.extend([bottom, id(i, 0), id(i + 1, 0), top, id(i + 1, along - 1), id(i, along - 1)]);
        }
        let ring = 4;
        let contour = (0..around).flat_map(|i| [id(i, ring), id(i + 1, ring)]).collect();
        (positions, indices, contour)
    }

    #[test]
    fn the_field_is_signed_by_side_and_bounded_by_its_reach() {
        let (positions, indices, contour) = tube();
        let mesh = Mesh::new(&positions, &indices);
        let graph = face_graph(&mesh, true).unwrap();
        // Region 1 (fitting) below the ring, 0 above it.
        let region: Vec<u8> = (0..mesh.face_count()).map(|f| u8::from(graph.centroids[f * 3 + 1] < 1.0)).collect();
        let field = contour_field(&graph, &mesh, &region, &contour, [0.6, 0.3]).unwrap();
        for (face, &s) in field.signed.iter().enumerate() {
            if s.is_finite() {
                assert_eq!(s > 0.0, region[face] == 0, "face {face} signed {s}");
                assert!(s <= 0.6 && s >= -0.3);
            }
        }
        let band = field.band(0.0, 0.6);
        assert!(band.iter().zip(&region).all(|(&b, &r)| b == 0 || r == 0));
        assert!(field.band(-0.3, 0.6).iter().filter(|&&b| b == 1).count() > band.iter().filter(|&&b| b == 1).count());
    }
}
