//! Overlay vertices for display-only layers: a finer copy of a mesh for painting zones
//! (`refine_for_overlay`), the approved-face overlay and the contour segments of a face-mask layer.

use std::collections::HashMap;

/// Splits every edge longer than `max_edge` at its midpoint, longest first while the result stays
/// within `max_triangles`; a split edge is split in both its triangles at one shared midpoint
/// (no cracks). Original vertices come first, winding is kept. A mesh that already fits comes back
/// unchanged.
pub fn refine_for_overlay(positions: &[f32], indices: &[u32], max_edge: f64, max_triangles: usize) -> (Vec<f32>, Vec<u32>) {
    let mut positions = positions.to_vec();
    let mut indices = indices.to_vec();
    let max2 = max_edge * max_edge;
    for _pass in 0..40 {
        let triangles = indices.len() / 3;
        let edges = edge_table(&indices);
        let length2: Vec<f64> = edges
            .ends
            .iter()
            .map(|&(a, b)| (0..3).map(|k| (coord(&positions, a, k) - coord(&positions, b, k)).powi(2)).sum::<f64>())
            .collect();
        let mut long: Vec<usize> = (0..edges.ends.len()).filter(|&e| length2[e] > max2).collect();
        if long.is_empty() {
            break;
        }
        let mut added: usize = long.iter().map(|&e| edges.faces[e] as usize).sum();
        if triangles + added > max_triangles {
            long.sort_by(|&x, &y| length2[y].total_cmp(&length2[x]));
            added = 0;
            let mut take = 0;
            while take < long.len() && triangles + added + edges.faces[long[take]] as usize <= max_triangles {
                added += edges.faces[long[take]] as usize;
                take += 1;
            }
            long.truncate(take);
            if take == 0 {
                break;
            }
        }
        let mut mid = vec![-1i64; edges.ends.len()];
        let mut vertex_count = positions.len() / 3;
        for &e in &long {
            let (a, b) = edges.ends[e];
            for k in 0..3 {
                let mean = (coord(&positions, a, k) + coord(&positions, b, k)) / 2.0;
                positions.push(mean as f32);
            }
            mid[e] = vertex_count as i64;
            vertex_count += 1;
        }
        indices = split_triangles(&indices, &edges.tri_edges, &mid, &positions, triangles + added);
    }
    (positions, indices)
}

fn coord(positions: &[f32], v: u32, k: usize) -> f64 {
    f64::from(positions[v as usize * 3 + k])
}

struct Edges {
    ends: Vec<(u32, u32)>,
    faces: Vec<u32>,
    /// Edge of each triangle corner `c` (from corner c to the next corner of its triangle).
    tri_edges: Vec<u32>,
}

fn edge_table(indices: &[u32]) -> Edges {
    let mut ids: HashMap<(u32, u32), u32> = HashMap::with_capacity(indices.len());
    let mut edges = Edges { ends: Vec::new(), faces: Vec::new(), tri_edges: Vec::with_capacity(indices.len()) };
    for c in 0..indices.len() {
        let t = c - c % 3;
        let (u, v) = (indices[c], indices[t + (c - t + 1) % 3]);
        let key = if u < v { (u, v) } else { (v, u) };
        let e = *ids.entry(key).or_insert_with(|| {
            edges.ends.push(key);
            edges.faces.push(0);
            (edges.ends.len() - 1) as u32
        });
        edges.faces[e as usize] += 1;
        edges.tri_edges.push(e);
    }
    edges
}

fn split_triangles(indices: &[u32], tri_edges: &[u32], mid: &[i64], positions: &[f32], total: usize) -> Vec<u32> {
    let mut out = Vec::with_capacity(total * 3);
    let dist2 = |x: u32, y: u32| -> f64 {
        (0..3).map(|k| (f64::from(positions[x as usize * 3 + k]) - f64::from(positions[y as usize * 3 + k])).powi(2)).sum()
    };
    for t in (0..indices.len()).step_by(3) {
        // Edge k runs from corner k to corner k + 1.
        let m = [mid[tri_edges[t] as usize], mid[tri_edges[t + 1] as usize], mid[tri_edges[t + 2] as usize]];
        let splits = m.iter().filter(|&&v| v >= 0).count();
        if splits == 0 {
            out.extend_from_slice(&indices[t..t + 3]);
            continue;
        }
        if splits == 3 {
            let (v0, v1, v2) = (indices[t], indices[t + 1], indices[t + 2]);
            let (m0, m1, m2) = (m[0] as u32, m[1] as u32, m[2] as u32);
            out.extend_from_slice(&[v0, m0, m2, m0, v1, m1, m2, m1, v2, m0, m1, m2]);
            continue;
        }
        // Rotate the corners: one split -> it is edge 0; two splits -> the unsplit one is edge 2.
        let r = if splits == 1 {
            if m[0] >= 0 { 0 } else if m[1] >= 0 { 1 } else { 2 }
        } else if m[2] < 0 { 0 } else if m[0] < 0 { 1 } else { 2 };
        let (v0, v1, v2) = (indices[t + r], indices[t + (r + 1) % 3], indices[t + (r + 2) % 3]);
        let m0 = m[r] as u32;
        if splits == 1 {
            out.extend_from_slice(&[v0, m0, v2, m0, v1, v2]);
            continue;
        }
        let m1 = m[(r + 1) % 3] as u32;
        out.extend_from_slice(&[m0, v1, m1]);
        // The quad v0 m0 m1 v2 takes its shorter diagonal.
        if dist2(v0, m1) <= dist2(m0, v2) {
            out.extend_from_slice(&[v0, m0, m1, v0, m1, v2]);
        } else {
            out.extend_from_slice(&[v0, m0, v2, m0, m1, v2]);
        }
    }
    out
}

/// A separate vertex per approved triangle corner (positions and flat normals); `None` when the
/// mask length does not match the face count. Forbidden faces get no overlay.
pub fn face_mask_overlay(positions: &[f32], indices: &[u32], allowed: &[u8]) -> Option<(Vec<f32>, Vec<f32>)> {
    let faces = indices.len() / 3;
    if allowed.len() != faces {
        return None;
    }
    let selected = allowed.iter().filter(|&&v| v == 1).count();
    let mut out_positions = Vec::with_capacity(selected * 9);
    let mut out_normals = Vec::with_capacity(selected * 9);
    for face in (0..faces).filter(|&f| allowed[f] == 1) {
        let p: Vec<[f64; 3]> = (0..3)
            .map(|c| {
                let s = indices[face * 3 + c] as usize * 3;
                [f64::from(positions[s]), f64::from(positions[s + 1]), f64::from(positions[s + 2])]
            })
            .collect();
        for point in &p {
            out_positions.extend(point.iter().map(|&v| v as f32));
        }
        let (a, b) = ([p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]);
        let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        let size = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        let n = if size == 0.0 { [0.0; 3] } else { [n[0] / size, n[1] / size, n[2] / size] };
        for _ in 0..3 {
            out_normals.extend(n.iter().map(|&v| v as f32));
        }
    }
    Some((out_positions, out_normals))
}

/// Each pair names one real mesh edge: the positions of its two vertices, back to back.
pub fn face_mask_contour_segments(positions: &[f32], pairs: &[u32]) -> Vec<f32> {
    pairs.iter().flat_map(|&v| positions[v as usize * 3..v as usize * 3 + 3].iter().copied()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_edges_are_untouched_and_long_ones_split_without_cracks() {
        let p = [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let (pp, ii) = refine_for_overlay(&p, &[0, 1, 2], 5.0, 100);
        assert_eq!((pp.len(), ii.len()), (9, 3));
        let (pp, ii) = refine_for_overlay(&p, &[0, 1, 2], 0.5, 100);
        assert!(ii.len() > 3 && pp.len() > 9);
        // Every output triangle keeps the original winding (+Z).
        for t in ii.chunks(3) {
            let v = |i: u32| &pp[i as usize * 3..i as usize * 3 + 3];
            let (a, b, c) = (v(t[0]), v(t[1]), v(t[2]));
            assert!((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0.0);
        }
        let (_, capped) = refine_for_overlay(&p, &[0, 1, 2], 0.01, 8);
        assert!(capped.len() / 3 <= 8);
    }

    #[test]
    fn face_overlay_keeps_only_allowed_faces_and_rejects_a_wrong_mask() {
        let p = [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
        let i = [0u32, 1, 2, 1, 3, 2];
        let (pos, nrm) = face_mask_overlay(&p, &i, &[0, 1]).unwrap();
        assert_eq!((pos.len(), nrm.len()), (9, 9));
        assert_eq!(&nrm[0..3], &[0.0, 0.0, 1.0]);
        assert!(face_mask_overlay(&p, &i, &[1]).is_none());
        assert_eq!(face_mask_contour_segments(&p, &[0, 3]), vec![0.0, 0.0, 0.0, 1.0, 1.0, 0.0]);
    }
}
