use crate::mesh::MeshError;
use std::collections::HashMap;

pub struct WeldedMesh {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}

pub fn weld_positions(
    positions: &mut [f32],
    indices: &[u32],
    matrix: &[f64],
) -> Result<WeldedMesh, MeshError> {
    if positions.is_empty() || positions.len() % 3 != 0 || matrix.len() != 16 {
        return Err(MeshError::InvalidLength);
    }
    if positions.iter().any(|value| !value.is_finite())
        || matrix.iter().any(|value| !value.is_finite())
    {
        return Err(MeshError::NonFinite);
    }
    let vertices = positions.len() / 3;
    if indices.iter().any(|index| *index as usize >= vertices) {
        return Err(MeshError::InvalidIndex);
    }
    // Match Vector3.applyMatrix4: f64 arithmetic, rounded on assignment to a Float32Array.
    for point in positions.chunks_exact_mut(3) {
        let [x, y, z] = [
            f64::from(point[0]),
            f64::from(point[1]),
            f64::from(point[2]),
        ];
        let w = 1.0 / (matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]);
        let transformed = [
            (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * w,
            (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * w,
            (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * w,
        ];
        let rounded = transformed.map(|value| value as f32);
        if rounded.iter().any(|value| !value.is_finite()) {
            return Err(MeshError::NonFinite);
        }
        point.copy_from_slice(&rounded);
    }
    let multiplier = 10.0_f64.powf((1.0_f64 / 1e-4_f64).log10());
    let additive = 0.5e-4_f64 * multiplier;
    let corners = if indices.is_empty() {
        vertices
    } else {
        indices.len()
    };
    let possible_unique = vertices.min(corners);
    let mut seen = HashMap::<[i32; 3], u32>::with_capacity(possible_unique);
    let mut welded = Vec::with_capacity(possible_unique.checked_mul(3).ok_or(MeshError::Capacity)?);
    let mut out_indices = Vec::with_capacity(corners);
    for corner in 0..corners {
        let vertex = if indices.is_empty() {
            corner
        } else {
            indices[corner] as usize
        };
        let point = &positions[vertex * 3..vertex * 3 + 3];
        let key = [
            js_int32(f64::from(point[0]) * multiplier + additive),
            js_int32(f64::from(point[1]) * multiplier + additive),
            js_int32(f64::from(point[2]) * multiplier + additive),
        ];
        let index = if let Some(index) = seen.get(&key) {
            *index
        } else {
            let index = u32::try_from(welded.len() / 3).map_err(|_| MeshError::Capacity)?;
            welded.extend_from_slice(point);
            seen.insert(key, index);
            index
        };
        out_indices.push(index);
    }
    Ok(WeldedMesh {
        positions: welded,
        indices: out_indices,
    })
}

/// JavaScript `~~` truncates and wraps to signed 32 bits, including values above i32::MAX.
fn js_int32(value: f64) -> i32 {
    value.trunc().rem_euclid(4_294_967_296.0) as u32 as i32
}

#[cfg(test)]
mod tests {
    use super::weld_positions;
    use crate::mesh::MeshError;

    const IDENTITY: [f64; 16] = [
        1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ];

    #[test]
    fn welds_duplicates_in_first_seen_order() {
        let mut raw = [0., 0., 0., 1., 0., 0., 0., 0., 0.];
        let out = weld_positions(&mut raw, &[], &IDENTITY).unwrap();
        assert_eq!(out.positions, [0., 0., 0., 1., 0., 0.]);
        assert_eq!(out.indices, [0, 1, 0]);
    }

    #[test]
    fn transforms_and_preserves_index_order() {
        let mut raw = [0., 0., 0., 1., 0., 0., 0., 0., 0.];
        let mut matrix = IDENTITY;
        matrix[12] = 3.;
        let out = weld_positions(&mut raw, &[2, 1, 0], &matrix).unwrap();
        assert_eq!(raw, [3., 0., 0., 4., 0., 0., 3., 0., 0.]);
        assert_eq!(out.positions, [3., 0., 0., 4., 0., 0.]);
        assert_eq!(out.indices, [0, 1, 0]);
    }

    #[test]
    fn rejects_invalid_indices_and_nonfinite_transforms() {
        let mut raw = [0., 0., 0.];
        assert!(matches!(
            weld_positions(&mut raw, &[1, 1, 1], &IDENTITY),
            Err(MeshError::InvalidIndex)
        ));
        let mut bad = IDENTITY;
        bad[12] = f64::NAN;
        assert!(matches!(
            weld_positions(&mut raw, &[], &bad),
            Err(MeshError::NonFinite)
        ));
        let mut overflow = IDENTITY;
        overflow[0] = 1e40;
        raw[0] = 1.;
        assert!(matches!(
            weld_positions(&mut raw, &[], &overflow),
            Err(MeshError::NonFinite)
        ));
    }
}
