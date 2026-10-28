//! Face and angle-weighted vertex normals in single precision (Newell face normals; each vertex
//! sums face normal times corner angle in face order).

use super::vec::single::{TINY, V3f, dot, normalize, sub};

const PIO2_HI: f32 = 1.570_796_251_3;
const PIO2_LO: f32 = 7.549_789_415_9e-8;
const PS0: f32 = 1.666_658_669_7e-1;
const PS1: f32 = -4.274_342_209_1e-2;
const PS2: f32 = -8.656_363_003_0e-3;
const QS1: f32 = -7.066_296_339_0e-1;
const PI: f32 = 3.141_592_502_6;

fn rational(z: f32) -> f32 {
    let p = z * (PS0 + z * (PS1 + z * PS2));
    let q = 1.0 + z * QS1;
    p / q
}

/// Single-precision arccos (FreeBSD msun e_acosf.c), every step rounded to f32 like the TS port
/// in src/core/acosf.ts, so degenerate near-cancelling vertex sums agree. NaN outside [-1, 1].
pub fn acosf(x: f32) -> f32 {
    let ax = x.abs();
    if ax >= 1.0 {
        return if ax == 1.0 { if x < 0.0 { PI + 2.0 * PIO2_LO } else { 0.0 } } else { f32::NAN };
    }
    if ax < 0.5 {
        if ax <= 1.0 / 67_108_864.0 {
            return PIO2_HI + PIO2_LO;
        }
        return PIO2_HI - (x - (PIO2_LO - x * rational(x * x)));
    }
    if x < 0.0 {
        let z = (1.0 + x) * 0.5;
        let s = z.sqrt();
        let w = rational(z) * s - PIO2_LO;
        return 2.0 * (PIO2_HI - (s + w));
    }
    let z = (1.0 - x) * 0.5;
    let s = z.sqrt();
    let df = f32::from_bits(s.to_bits() & 0xffff_f000);
    let c = (z - df * df) / (s + df);
    let w = rational(z) * s + c;
    2.0 * (df + w)
}

fn point(positions: &[f32], vertex: u32) -> V3f {
    let o = vertex as usize * 3;
    [positions[o], positions[o + 1], positions[o + 2]]
}

/// Newell's method from the closing edge (last corner to first); +Z when degenerate.
pub fn face_normal(positions: &[V3f], face: &[u32]) -> V3f {
    let (mut nx, mut ny, mut nz) = (0.0f32, 0.0f32, 0.0f32);
    let mut a = positions[face[face.len() - 1] as usize];
    for &vertex in face {
        let b = positions[vertex as usize];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
        a = b;
    }
    let length_sq = dot([nx, ny, nz], [nx, ny, nz]);
    if !(length_sq > TINY) {
        return [0.0, 0.0, 1.0];
    }
    let inverse = 1.0 / length_sq.sqrt();
    [nx * inverse, ny * inverse, nz * inverse]
}

/// Angle-weighted unit vertex normals of polygon faces; a vertex in no face takes its own position
/// direction.
pub fn polygon_vertex_normals<'a>(positions: &[V3f], faces: impl IntoIterator<Item = &'a [u32]>) -> Vec<V3f> {
    let mut sums: Vec<V3f> = vec![[0.0; 3]; positions.len()];
    let mut used = vec![false; positions.len()];
    for face in faces {
        let normal = face_normal(positions, face);
        let n = face.len();
        for corner in 0..n {
            let vertex = face[corner] as usize;
            let here = positions[vertex];
            let to_prev = normalize(sub(positions[face[(corner + n - 1) % n] as usize], here));
            let to_next = normalize(sub(positions[face[(corner + 1) % n] as usize], here));
            let weight = acosf(dot(to_prev, to_next));
            for axis in 0..3 {
                sums[vertex][axis] += normal[axis] * weight;
            }
            used[vertex] = true;
        }
    }
    sums.iter().enumerate().map(|(vertex, sum)| normalize(if used[vertex] { *sum } else { positions[vertex] })).collect()
}

/// Angle-weighted unit vertex normals of a triangle mesh (3 floats per vertex).
pub fn vertex_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let points: Vec<V3f> = (0..positions.len() as u32 / 3).map(|v| point(positions, v)).collect();
    polygon_vertex_normals(&points, indices.chunks_exact(3)).concat()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acosf_matches_the_reference_values() {
        assert_eq!(acosf(1.0), 0.0);
        assert!((acosf(0.0) - std::f32::consts::FRAC_PI_2).abs() < 1e-6);
        assert!((acosf(-1.0) - std::f32::consts::PI).abs() < 1e-6);
        for k in -99..=99 {
            let x = k as f32 / 100.0;
            assert!((acosf(x) - x.acos()).abs() < 1e-6, "x = {x}");
        }
        assert!(acosf(1.5).is_nan());
    }

    #[test]
    fn flat_triangle_has_its_face_normal_at_every_vertex() {
        let p = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let n = vertex_normals(&p, &[0, 1, 2]);
        for v in n.chunks(3) {
            assert!((v[2] - 1.0).abs() < 1e-6 && v[0].abs() < 1e-6);
        }
    }

    #[test]
    fn a_flat_quad_has_its_normal_at_every_corner() {
        let positions = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]];
        let normals = polygon_vertex_normals(&positions, [&[0u32, 1, 2, 3][..]]);
        assert!(normals.iter().all(|n| (n[2] - 1.0).abs() < 1e-6));
    }

    #[test]
    fn degenerate_face_is_plus_z_and_orphan_vertex_points_outward() {
        assert_eq!(face_normal(&[[0.0; 3]; 3], &[0, 1, 2]), [0.0, 0.0, 1.0]);
        let p = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 5.0];
        let n = vertex_normals(&p, &[0, 1, 2]);
        assert_eq!(&n[9..12], &[0.0, 0.0, 1.0]);
    }
}
