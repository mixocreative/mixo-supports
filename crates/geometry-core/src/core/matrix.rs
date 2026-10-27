//! Rigid placements, general 4x4 inverse, points/directions through a matrix, handedness.
//! Column-major `[col * 4 + row]` like three.js and Babylon. Arithmetic follows three.js r173
//! operation for operation, so results match the three.js matrices the host used before.

pub type Matrix4 = [f64; 16];

/// Whether outputs stay in the core's right-handed frame or are mirrored (Z negated) for a
/// left-handed host such as Babylon. Mirroring is exact: sign flips only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handedness {
    Right,
    Left,
}

impl Handedness {
    pub fn from_flag(flag: u32) -> Option<Self> {
        match flag {
            0 => Some(Self::Right),
            1 => Some(Self::Left),
            _ => None,
        }
    }
}

/// Rotation quaternion `[x, y, z, w]` of Euler XYZ angles (radians).
pub fn quaternion_from_euler([x, y, z]: [f64; 3]) -> [f64; 4] {
    let (c1, c2, c3) = ((x / 2.0).cos(), (y / 2.0).cos(), (z / 2.0).cos());
    let (s1, s2, s3) = ((x / 2.0).sin(), (y / 2.0).sin(), (z / 2.0).sin());
    [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
        c1 * c2 * c3 - s1 * s2 * s3,
    ]
}

/// Placement matrix (unit scale): object-local point to parent (plate) space.
pub fn placement_matrix(position: [f64; 3], rotation: [f64; 3]) -> Matrix4 {
    let [x, y, z, w] = quaternion_from_euler(rotation);
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    [
        1.0 - (yy + zz), xy + wz, xz - wy, 0.0,
        xy - wz, 1.0 - (xx + zz), yz + wx, 0.0,
        xz + wy, yz - wx, 1.0 - (xx + yy), 0.0,
        position[0], position[1], position[2], 1.0,
    ]
}

/// General 4x4 inverse (all zeros when singular, as three.js does).
pub fn invert_matrix(te: &Matrix4) -> Matrix4 {
    let (n11, n21, n31, n41) = (te[0], te[1], te[2], te[3]);
    let (n12, n22, n32, n42) = (te[4], te[5], te[6], te[7]);
    let (n13, n23, n33, n43) = (te[8], te[9], te[10], te[11]);
    let (n14, n24, n34, n44) = (te[12], te[13], te[14], te[15]);
    let t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    let t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    let t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    let t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
    let det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if det == 0.0 {
        return [0.0; 16];
    }
    let d = 1.0 / det;
    [
        t11 * d,
        (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
        (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
        (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,
        t12 * d,
        (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
        (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
        (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,
        t13 * d,
        (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
        (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
        (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,
        t14 * d,
        (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
        (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
        (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d,
    ]
}

/// A point through a matrix, with the projective divide.
pub fn apply_to_point(e: &Matrix4, x: f64, y: f64, z: f64) -> [f64; 3] {
    let w = 1.0 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    [
        (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) * w,
    ]
}

/// A direction through a matrix's linear part, normalised (zero stays zero). Rigid matrices only.
pub fn apply_to_direction(e: &Matrix4, x: f64, y: f64, z: f64) -> [f64; 3] {
    let dx = e[0] * x + e[4] * y + e[8] * z;
    let dy = e[1] * x + e[5] * y + e[9] * z;
    let dz = e[2] * x + e[6] * y + e[10] * z;
    let length = (dx * dx + dy * dy + dz * dz).sqrt();
    let scale = 1.0 / if length == 0.0 { 1.0 } else { length };
    [dx * scale, dy * scale, dz * scale]
}

/// A core-frame matrix conjugated into the left-handed frame: `S * M * S`, S = diag(1, 1, -1, 1).
pub fn to_left_handed_matrix(matrix: &Matrix4) -> Matrix4 {
    let mut out = *matrix;
    for index in [2, 6, 14, 8, 9, 11] {
        out[index] = -out[index];
    }
    out
}

/// Every xyz triple through `matrix` (single precision out). With `Left` the result is mirrored
/// in Z afterwards.
pub fn transform_positions(positions: &[f32], matrix: &Matrix4, handedness: Handedness) -> Vec<f32> {
    let mut out = Vec::with_capacity(positions.len());
    for p in positions.chunks_exact(3) {
        let [x, y, z] = apply_to_point(matrix, f64::from(p[0]), f64::from(p[1]), f64::from(p[2]));
        let z = z as f32;
        out.extend_from_slice(&[x as f32, y as f32, if handedness == Handedness::Left { -z } else { z }]);
    }
    out
}

/// Lowest transformed y over all vertices, in single precision exactly like `transform_positions` rounds
/// it (infinity for no vertex): the model's resting height without copying the transformed mesh.
pub fn transformed_min_y(positions: &[f32], matrix: &Matrix4) -> f32 {
    positions
        .chunks_exact(3)
        .map(|p| apply_to_point(matrix, f64::from(p[0]), f64::from(p[1]), f64::from(p[2]))[1] as f32)
        .fold(f32::INFINITY, f32::min)
}

/// A batch of f64 xyz triples through `matrix`: points (with divide) or directions (normalised).
pub fn transform_vectors(values: &[f64], matrix: &Matrix4, direction: bool) -> Vec<f64> {
    let mut out = Vec::with_capacity(values.len());
    for p in values.chunks_exact(3) {
        out.extend_from_slice(&if direction {
            apply_to_direction(matrix, p[0], p[1], p[2])
        } else {
            apply_to_point(matrix, p[0], p[1], p[2])
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transformed_min_y_is_the_lowest_rounded_y_of_the_transformed_positions() {
        let m = placement_matrix([3.0, -2.0, 5.0], [0.4, -1.1, 2.0]);
        let positions = [1.0f32, 2.5, -3.0, -4.0, 0.25, 7.0, 0.5, 9.0, 1.5];
        let moved = transform_positions(&positions, &m, Handedness::Right);
        let lowest = moved.chunks_exact(3).map(|p| p[1]).fold(f32::INFINITY, f32::min);
        assert_eq!(transformed_min_y(&positions, &m), lowest);
        assert_eq!(transformed_min_y(&[], &m), f32::INFINITY);
    }

    #[test]
    fn placement_inverse_round_trips_a_point() {
        let m = placement_matrix([3.0, -2.0, 5.0], [0.4, -1.1, 2.0]);
        let back = apply_to_point(&invert_matrix(&m), 1.0, 2.0, 3.0);
        let there = apply_to_point(&m, back[0], back[1], back[2]);
        for (a, b) in there.iter().zip([1.0, 2.0, 3.0]) {
            assert!((a - b).abs() < 1e-12);
        }
    }

    #[test]
    fn quarter_turn_about_z_maps_x_to_y() {
        let m = placement_matrix([0.0; 3], [0.0, 0.0, std::f64::consts::FRAC_PI_2]);
        let p = apply_to_point(&m, 1.0, 0.0, 0.0);
        assert!(p[0].abs() < 1e-12 && (p[1] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn left_handed_output_equals_conjugated_matrix_on_mirrored_input() {
        let m = placement_matrix([1.0, 2.0, 3.0], [0.3, 0.2, 0.1]);
        let positions = [1.0f32, 2.0, 3.0, -4.0, 5.0, 6.0];
        let left = transform_positions(&positions, &m, Handedness::Left);
        let mirrored: Vec<f32> = positions.chunks(3).flat_map(|p| [p[0], p[1], -p[2]]).collect();
        let conj = transform_positions(&mirrored, &to_left_handed_matrix(&m), Handedness::Right);
        for (a, b) in left.iter().zip(&conj) {
            assert!((a - b).abs() < 1e-5);
        }
    }

    #[test]
    fn singular_matrix_inverts_to_zeros_and_zero_direction_stays_zero() {
        assert_eq!(invert_matrix(&[0.0; 16]), [0.0; 16]);
        let id = placement_matrix([0.0; 3], [0.0; 3]);
        assert_eq!(apply_to_direction(&id, 0.0, 0.0, 0.0), [0.0; 3]);
    }
}
