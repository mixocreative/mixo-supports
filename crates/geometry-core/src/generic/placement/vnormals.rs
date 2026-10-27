//! Angle-weighted vertex normals of a polygon mesh in single precision (Blender true normals up to
//! the corner angle: Blender uses a polynomial arccos approximation, this the `acosf` port):
//! Newell face normals; each vertex sums, over its faces in face order, the face normal times the
//! corner angle. A vertex in no face takes its own position direction. Positions are Blender axes.

use crate::core::normals::acosf;

type V3f = [f32; 3];

/// Squared lengths at or below this normalise to zero.
const TINY: f64 = 1e-35;

fn dot(a: V3f, b: V3f) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn difference(a: V3f, b: V3f) -> V3f {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// Unit vector by division by the length; zero when (nearly) zero.
fn divide_by_length(v: V3f) -> V3f {
    let length_sq = dot(v, v);
    if !(f64::from(length_sq) > TINY) {
        return [0.0; 3];
    }
    let length = length_sq.sqrt();
    [v[0] / length, v[1] / length, v[2] / length]
}

/// Newell's method from the closing edge (last corner to first); +Z when degenerate.
pub fn face_normal(positions: &[V3f], face: &[u32]) -> V3f {
    let (mut nx, mut ny, mut nz) = (0f32, 0f32, 0f32);
    let mut a = positions[face[face.len() - 1] as usize];
    for &vertex in face {
        let b = positions[vertex as usize];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
        a = b;
    }
    let length_sq = dot([nx, ny, nz], [nx, ny, nz]);
    if !(f64::from(length_sq) > TINY) {
        return [0.0, 0.0, 1.0];
    }
    let inverse = 1.0 / length_sq.sqrt();
    [nx * inverse, ny * inverse, nz * inverse]
}

pub fn vertex_normals(positions: &[V3f], faces: &[Vec<u32>]) -> Vec<V3f> {
    let mut sums: Vec<V3f> = vec![[0.0; 3]; positions.len()];
    let mut used = vec![false; positions.len()];
    for face in faces {
        let normal = face_normal(positions, face);
        let n = face.len();
        for corner in 0..n {
            let vertex = face[corner] as usize;
            let here = positions[vertex];
            let to_prev = divide_by_length(difference(positions[face[(corner + n - 1) % n] as usize], here));
            let to_next = divide_by_length(difference(positions[face[(corner + 1) % n] as usize], here));
            let weight = acosf(dot(to_prev, to_next));
            for axis in 0..3 {
                sums[vertex][axis] += normal[axis] * weight;
            }
            used[vertex] = true;
        }
    }
    sums.iter().enumerate().map(|(vertex, sum)| divide_by_length(if used[vertex] { *sum } else { positions[vertex] })).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_quad_has_its_normal_at_every_corner() {
        let positions = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]];
        let normals = vertex_normals(&positions, &[vec![0, 1, 2, 3]]);
        assert!(normals.iter().all(|n| (n[2] - 1.0).abs() < 1e-6));
    }
}
