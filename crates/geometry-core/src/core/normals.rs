//! Face and angle-weighted vertex normals in single precision (Newell face normals; each vertex
//! sums face normal times corner angle in face order). Triangle meshes only.

const TINY: f32 = 1e-35;

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

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn point(positions: &[f32], vertex: u32) -> [f32; 3] {
    let o = vertex as usize * 3;
    [positions[o], positions[o + 1], positions[o + 2]]
}

fn divide_by_length(v: [f32; 3]) -> [f32; 3] {
    let length_sq = dot(v, v);
    if !(length_sq > TINY) {
        return [0.0; 3];
    }
    let length = length_sq.sqrt();
    [v[0] / length, v[1] / length, v[2] / length]
}

/// Newell's method from the closing edge (last corner to first); +Z when degenerate.
pub fn face_normal(positions: &[f32], face: [u32; 3]) -> [f32; 3] {
    let (mut nx, mut ny, mut nz) = (0.0f32, 0.0f32, 0.0f32);
    let mut a = point(positions, face[2]);
    for vertex in face {
        let b = point(positions, vertex);
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

/// Angle-weighted unit vertex normals (3 floats per vertex); a vertex in no face takes its own
/// position direction.
pub fn vertex_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let count = positions.len() / 3;
    let mut sums = vec![[0.0f32; 3]; count];
    let mut used = vec![false; count];
    for tri in indices.chunks_exact(3) {
        let face = [tri[0], tri[1], tri[2]];
        let normal = face_normal(positions, face);
        for corner in 0..3 {
            let vertex = face[corner];
            let here = point(positions, vertex);
            let diff = |other: [f32; 3]| {
                divide_by_length([other[0] - here[0], other[1] - here[1], other[2] - here[2]])
            };
            let to_prev = diff(point(positions, face[(corner + 2) % 3]));
            let to_next = diff(point(positions, face[(corner + 1) % 3]));
            let weight = acosf(dot(to_prev, to_next));
            let sum = &mut sums[vertex as usize];
            for axis in 0..3 {
                sum[axis] += normal[axis] * weight;
            }
            used[vertex as usize] = true;
        }
    }
    let mut out = Vec::with_capacity(count * 3);
    for (vertex, sum) in sums.iter().enumerate() {
        let v = if used[vertex] { *sum } else { point(positions, vertex as u32) };
        out.extend_from_slice(&divide_by_length(v));
    }
    out
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
    fn degenerate_face_is_plus_z_and_orphan_vertex_points_outward() {
        assert_eq!(face_normal(&[0.0; 9], [0, 1, 2]), [0.0, 0.0, 1.0]);
        let p = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 5.0];
        let n = vertex_normals(&p, &[0, 1, 2]);
        assert_eq!(&n[9..12], &[0.0, 0.0, 1.0]);
    }
}
