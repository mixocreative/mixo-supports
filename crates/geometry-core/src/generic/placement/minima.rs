//! Island minima of the remesh R, stage by stage as Resin UV's scatter computes them (checked against
//! its dumps in tools/blender-parity): candidates are vertices whose lowest adjacent edge midpoint is
//! not below them; Merge by Distance (Spacing, points exactly Spacing apart merge) mixes positions in
//! single precision; each merged point snaps to its nearest candidate and samples the nearest R
//! vertex (lowest index wins exact ties); the point is dropped when the acos of its normal z exceeds
//! Overhang angle. All of it runs on Blender axes (web (x, y, z) = Blender (x, -z, y)), single precision.

use super::merge::merge_by_distance;
use super::ridges::legacy_ridge_midpoints;
use super::vnormals::vertex_normals;
use super::PlacementSettings;
use crate::core::nearest::NearestPoint;
use crate::supports::remesh::fr;

type V3f = [f32; 3];

pub struct MinimaStages {
    /// Kept points in Blender axes.
    pub kept: Vec<V3f>,
    /// Whether the kept point's cluster holds a minimum (vertical contact; otherwise a ridge/edge contact).
    pub kept_vertical: Vec<bool>,
    /// Blender axes: the true normal of the R vertex each kept point sampled.
    pub kept_normals: Vec<V3f>,
}

/// Mean of each cluster in single precision: every member times 1 / n, summed in ascending index order.
fn cluster_means(points: &[V3f], clusters: &[Vec<usize>]) -> Vec<V3f> {
    clusters
        .iter()
        .map(|cluster| {
            let weight = 1.0f32 / cluster.len() as f32;
            let mut sum = [0.0f32; 3];
            let mut members = cluster.clone();
            members.sort_unstable();
            for k in members {
                for axis in 0..3 {
                    sum[axis] += points[k][axis] * weight;
                }
            }
            sum
        })
        .collect()
}

/// Whether each point (Blender axes) faces down enough: the single-precision true normal of its
/// nearest R vertex is within Overhang angle of -Z. Also returns the nearest vertex (None for none).
fn downward_test(points: &[V3f], vertices: &[V3f], normals: &[V3f], overhang_angle_degrees: f64) -> (Vec<bool>, Vec<Option<usize>>) {
    let flat: Vec<f32> = vertices.iter().flatten().copied().collect();
    let index = NearestPoint::new(&flat);
    let limit = fr(overhang_angle_degrees * std::f64::consts::PI / 180.0);
    let nearest: Vec<Option<usize>> = points.iter().map(|p| index.nearest_hit(*p).map(|(i, _)| i)).collect();
    let keep = nearest
        .iter()
        .map(|vertex| {
            let Some(vertex) = vertex else { return false };
            let down = f64::from(-normals[*vertex][2]);
            let angle = if down <= -1.0 { fr(std::f64::consts::PI) } else if down >= 1.0 { 0.0 } else { fr(down.acos()) };
            !(angle > limit)
        })
        .collect();
    (keep, nearest)
}

pub fn minima_stages(vertices_web: &[[f64; 3]], faces: &[Vec<u32>], s: &PlacementSettings) -> MinimaStages {
    let count = vertices_web.len();
    let mut lowest = vec![f64::INFINITY; count];
    for face in faces {
        for (k, &v) in face.iter().enumerate() {
            let w = face[(k + 1) % face.len()];
            let midpoint = (vertices_web[v as usize][1] + vertices_web[w as usize][1]) / 2.0;
            if midpoint < lowest[v as usize] {
                lowest[v as usize] = midpoint;
            }
            if midpoint < lowest[w as usize] {
                lowest[w as usize] = midpoint;
            }
        }
    }
    let candidates: Vec<usize> = (0..count).filter(|&v| lowest[v] != f64::INFINITY && !(lowest[v] < vertices_web[v][1])).collect();
    // Blender axes (web (x, y, z) = Blender (x, -z, y)).
    let blender: Vec<V3f> = vertices_web.iter().map(|v| [v[0] as f32, (-v[2]) as f32, v[1] as f32]).collect();
    let normals = vertex_normals(&blender, faces);
    let ridge_midpoints = if s.reinforce_edges { Vec::new() } else { legacy_ridge_midpoints(&blender, faces, &normals, s.sharp_edge_angle_degrees, s.overhang_angle_degrees) };
    let mut points: Vec<V3f> = candidates.iter().map(|&v| blender[v]).collect();
    points.extend(ridge_midpoints);
    let flat: Vec<f32> = points.iter().flatten().copied().collect();
    let clusters = merge_by_distance(&flat, s.spacing);
    let merged = cluster_means(&points, &clusters);
    let candidate_index = NearestPoint::new(&flat);
    let snapped: Vec<V3f> = merged.iter().map(|c| candidate_index.nearest_hit(*c).map_or([0.0; 3], |(_, co)| co)).collect();
    let (keep, nearest) = downward_test(&snapped, &blender, &normals, s.overhang_angle_degrees);
    let mut out = MinimaStages { kept: Vec::new(), kept_vertical: Vec::new(), kept_normals: Vec::new() };
    for (k, cluster) in clusters.iter().enumerate() {
        if !keep[k] {
            continue;
        }
        out.kept.push(snapped[k]);
        out.kept_vertical.push(cluster.iter().any(|&index| index < candidates.len()));
        out.kept_normals.push(normals[nearest[k].expect("kept points have a nearest vertex")]);
    }
    out
}
