//! The legacy SDF ridge points of Resin UV's patched scatter, used while Reinforce Overhang Edges is
//! off, on the remesh R (Blender axes, Z up): the midpoint (single precision) of each edge whose
//! signed angle exceeds Ridge Angle and whose edge normal has z <= -cos(Overhang Angle).

use crate::core::jsnum::hypot3;
use crate::core::vec::{V3, dot, normalize};
use std::collections::HashMap;

type V3f = [f32; 3];

fn to_f64(p: V3f) -> V3 {
    [f64::from(p[0]), f64::from(p[1]), f64::from(p[2])]
}

/// Unique undirected edges `[low, high]` of the face loops, in order of first use: faces in index
/// order, each loop walked from its closing edge (last corner to first), then 0-1, 1-2...
/// Degenerate edges are skipped.
pub fn mesh_edges(faces: &[Vec<u32>]) -> Vec<(u32, u32)> {
    let mut seen: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
    let mut edges = Vec::new();
    for face in faces {
        for k in 0..face.len() {
            let a = face[(k + face.len() - 1) % face.len()];
            let b = face[k];
            if a == b {
                continue;
            }
            let edge = if a < b { (a, b) } else { (b, a) };
            if seen.insert(edge) {
                edges.push(edge);
            }
        }
    }
    edges
}

/// Newell normal of a face loop (unit, or zero when degenerate), double precision.
fn newell_normal(positions: &[V3f], face: &[u32]) -> V3 {
    let mut n = [0.0f64; 3];
    for k in 0..face.len() {
        let p = to_f64(positions[face[k] as usize]);
        let q = to_f64(positions[face[(k + 1) % face.len()] as usize]);
        n[0] += (p[1] - q[1]) * (p[2] + q[2]);
        n[1] += (p[2] - q[2]) * (p[0] + q[0]);
        n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    }
    normalize(n)
}

/// Signed dihedral angle of each edge (radians): 0 unless exactly two face loops use it; otherwise
/// the angle between the two face normals (the first face to use the edge is face 1), positive where
/// the edge is convex (face 2's centroid lies below face 1's plane), negative where it is concave.
pub fn signed_edge_angles(positions: &[V3f], faces: &[Vec<u32>], edges: &[(u32, u32)]) -> Vec<f64> {
    let index: HashMap<(u32, u32), usize> = edges.iter().enumerate().map(|(e, &edge)| (edge, e)).collect();
    let mut users: Vec<Vec<usize>> = vec![Vec::new(); edges.len()];
    for (face_index, face) in faces.iter().enumerate() {
        for (k, &v) in face.iter().enumerate() {
            let w = face[(k + 1) % face.len()];
            let key = if v < w { (v, w) } else { (w, v) };
            if let Some(&e) = index.get(&key) {
                users[e].push(face_index);
            }
        }
    }
    edges
        .iter()
        .enumerate()
        .map(|(e, &(a, b))| {
            if users[e].len() != 2 {
                return 0.0;
            }
            let (first, second) = (users[e][0], users[e][1]);
            let n1 = newell_normal(positions, &faces[first]);
            let n2 = newell_normal(positions, &faces[second]);
            let c = [n1[1] * n2[2] - n1[2] * n2[1], n1[2] * n2[0] - n1[0] * n2[2], n1[0] * n2[1] - n1[1] * n2[0]];
            let angle = hypot3(c).atan2(dot(n1, n2));
            let face2 = &faces[second];
            let mut sum = [0.0; 3];
            for &v in face2 {
                let p = to_f64(positions[v as usize]);
                sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
            }
            let centroid = [sum[0] / face2.len() as f64, sum[1] / face2.len() as f64, sum[2] / face2.len() as f64];
            let (pa, pb) = (to_f64(positions[a as usize]), to_f64(positions[b as usize]));
            let midpoint = [(pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0, (pa[2] + pb[2]) / 2.0];
            let d = [centroid[0] - midpoint[0], centroid[1] - midpoint[1], centroid[2] - midpoint[2]];
            if dot(n1, d) >= 0.0 { -angle } else { angle }
        })
        .collect()
}

/// Midpoints (single precision) of the edges, in `mesh_edges` order, whose signed angle exceeds
/// Ridge Angle and whose edge normal (normalised mean of its two vertex normals) has
/// z <= -cos(Overhang Angle). Stock SLASG compares with -acos(Angle); the add-on patch uses the cosine.
pub fn legacy_ridge_midpoints(
    positions: &[V3f],
    faces: &[Vec<u32>],
    vertex_normals: &[V3f],
    ridge_angle_degrees: f64,
    overhang_angle_degrees: f64,
) -> Vec<V3f> {
    let edges = mesh_edges(faces);
    let angles = signed_edge_angles(positions, faces, &edges);
    let ridge = ridge_angle_degrees * std::f64::consts::PI / 180.0;
    let limit = -(overhang_angle_degrees * std::f64::consts::PI / 180.0).cos();
    let mut midpoints = Vec::new();
    for (e, &(a, b)) in edges.iter().enumerate() {
        if !(angles[e] > ridge) {
            continue;
        }
        let (na, nb) = (to_f64(vertex_normals[a as usize]), to_f64(vertex_normals[b as usize]));
        let normal = normalize([na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]]);
        if normal[2] > limit {
            continue;
        }
        let (pa, pb) = (positions[a as usize], positions[b as usize]);
        midpoints.push([0, 1, 2].map(|axis| ((f64::from(pa[axis]) + f64::from(pb[axis])) / 2.0) as f32));
    }
    midpoints
}
