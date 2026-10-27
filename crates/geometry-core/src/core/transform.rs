use crate::core::mesh::{Bounds, MeshError};

pub struct Centering {
    pub center: [f64; 3],
    pub bounds: Bounds,
}

pub fn center_positions(positions: &mut [f32]) -> Result<Centering, MeshError> {
    if positions.is_empty() || positions.len() % 3 != 0 {
        return Err(MeshError::InvalidLength);
    }
    if positions.iter().any(|value| !value.is_finite()) {
        return Err(MeshError::NonFinite);
    }
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for point in positions.chunks_exact(3) {
        for axis in 0..3 {
            min[axis] = min[axis].min(point[axis]);
            max[axis] = max[axis].max(point[axis]);
        }
    }
    let center = std::array::from_fn(|axis| (f64::from(min[axis]) + f64::from(max[axis])) / 2.0);
    for (index, coordinate) in positions.iter_mut().enumerate() {
        *coordinate = (f64::from(*coordinate) - center[index % 3]) as f32;
    }
    Ok(Centering {
        center,
        bounds: Bounds { min, max },
    })
}

#[cfg(test)]
mod tests {
    use super::center_positions;
    use crate::core::mesh::MeshError;

    #[test]
    fn centers_in_place_and_returns_original_bounds() {
        let mut positions = [8.0, -2.0, 4.0, 12.0, 4.0, 6.0];
        let result = center_positions(&mut positions).unwrap();
        assert_eq!(result.center, [10.0, 1.0, 5.0]);
        assert_eq!(result.bounds.min, [8.0, -2.0, 4.0]);
        assert_eq!(result.bounds.max, [12.0, 4.0, 6.0]);
        assert_eq!(positions, [-2.0, -3.0, -1.0, 2.0, 3.0, 1.0]);
    }

    #[test]
    fn rejects_bad_arrays_without_mutation() {
        let mut short = [1.0, 2.0];
        assert!(matches!(
            center_positions(&mut short),
            Err(MeshError::InvalidLength)
        ));
        assert_eq!(short, [1.0, 2.0]);
        let mut nonfinite = [1.0, f32::NAN, 3.0];
        assert!(matches!(
            center_positions(&mut nonfinite),
            Err(MeshError::NonFinite)
        ));
        assert!(nonfinite[1].is_nan());
    }
}
