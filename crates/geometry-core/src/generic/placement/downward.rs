//! Downward (overhang) faces and the connected regions they form.

use crate::supports::remesh::hypot;
use std::collections::HashMap;

/// Faces modelled at exactly the Overhang angle land a hair past it once rounded (a 45-degree plate
/// measures 45.00001), so the downward-face tests get this much slack.
pub const OVERHANG_TOLERANCE_DEGREES: f64 = 0.1;

/// The Overhang angle that downward faces are tested against.
pub fn face_overhang_limit(overhang_angle_degrees: f64) -> f64 {
    (overhang_angle_degrees + OVERHANG_TOLERANCE_DEGREES).min(90.0)
}

/// Whether each face points within `overhang_angle_degrees` of straight down. An angle of 0 accepts
/// only directly downward faces; 90 accepts every face with a downward component.
pub fn classify_downward_faces(positions: &[f32], indices: &[u32], overhang_angle_degrees: f64) -> Vec<bool> {
    let threshold = -(overhang_angle_degrees * std::f64::consts::PI / 180.0).cos();
    let p = |i: u32, axis: usize| f64::from(positions[i as usize * 3 + axis]);
    indices
        .chunks_exact(3)
        .map(|f| {
            let (a, b, c) = (f[0], f[1], f[2]);
            let (ab_x, ab_y, ab_z) = (p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2));
            let (ac_x, ac_y, ac_z) = (p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2));
            let normal_y = ab_z * ac_x - ab_x * ac_z;
            let length = hypot(&[ab_y * ac_z - ab_z * ac_y, normal_y, ab_x * ac_y - ab_y * ac_x]);
            length > 0.0 && normal_y < 0.0 && normal_y / length <= threshold + 1e-12
        })
        .collect()
}

/// Partitions qualifying faces by shared undirected mesh edges; each region's faces ascend and the
/// regions follow their lowest face.
pub fn partition_regions(indices: &[u32], downward: &[bool]) -> Vec<Vec<u32>> {
    let face_count = indices.len() / 3;
    let key = |a: u32, b: u32| if a < b { (a, b) } else { (b, a) };
    let mut by_edge: HashMap<(u32, u32), Vec<usize>> = HashMap::new();
    for face in (0..face_count).filter(|&f| downward[f]) {
        let v = &indices[face * 3..face * 3 + 3];
        for (a, b) in [(0, 1), (1, 2), (2, 0)] {
            by_edge.entry(key(v[a], v[b])).or_default().push(face);
        }
    }
    let mut visited = vec![false; face_count];
    let mut regions = Vec::new();
    for start in 0..face_count {
        if !downward[start] || visited[start] {
            continue;
        }
        let mut faces: Vec<u32> = Vec::new();
        let mut pending = vec![start];
        visited[start] = true;
        while let Some(face) = pending.pop() {
            faces.push(face as u32);
            let v = &indices[face * 3..face * 3 + 3];
            for (a, b) in [(0, 1), (1, 2), (2, 0)] {
                for &neighbour in &by_edge[&key(v[a], v[b])] {
                    if !visited[neighbour] {
                        visited[neighbour] = true;
                        pending.push(neighbour);
                    }
                }
            }
        }
        faces.sort_unstable();
        regions.push(faces);
    }
    regions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_floor_facing_down_is_downward_and_a_roof_is_not() {
        // Two triangles of a unit square at y = 0, wound so the normal points down (-y) and up (+y).
        let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0];
        let indices = [0, 1, 2, 0, 2, 1];
        let down = classify_downward_faces(&positions, &indices, 45.0);
        assert_eq!(down.iter().filter(|d| **d).count(), 1);
        assert_eq!(partition_regions(&indices, &down), vec![vec![if down[0] { 0 } else { 1 }]]);
    }
}
