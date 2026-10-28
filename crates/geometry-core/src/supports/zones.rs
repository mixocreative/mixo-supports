//! No-support zones: brush dabs painted on the model (unit-local data the host serialises), the
//! same `AreaStamp` rule as a policy's area edit: paint zones, erase clears.

use super::policy::AreaStamp;
use crate::core::vec::V3;

/// Whether `point` is zoned: the last stamp covering it decides.
pub fn zoned_at(zones: &[AreaStamp], point: V3, normal: Option<V3>) -> bool {
    AreaStamp::resolve(zones, point, normal).unwrap_or(false)
}


/// Flat stamps: `ZONE_STRIDE` f64 each: center xyz, normal xyz, radius, kind (1 paint, 0 erase).
pub const ZONE_STRIDE: usize = 8;

pub fn decode_zones(values: &[f64]) -> Option<Vec<AreaStamp>> {
    if values.len() % ZONE_STRIDE != 0 || values.iter().any(|v| !v.is_finite()) {
        return None;
    }
    Some(
        values
            .chunks_exact(ZONE_STRIDE)
            .map(|v| AreaStamp { center: [v[0], v[1], v[2]], normal: [v[3], v[4], v[5]], radius: v[6], allow: v[7] == 1.0 })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_covering_stamp_wins_and_the_far_side_is_left_out() {
        let paint = AreaStamp { center: [0.0; 3], normal: [0.0, 1.0, 0.0], radius: 2.0, allow: true };
        let erase = AreaStamp { allow: false, radius: 1.0, ..paint };
        assert!(zoned_at(&[paint], [1.5, 0.0, 0.0], Some([0.0, 1.0, 0.0])));
        assert!(!zoned_at(&[paint, erase], [0.5, 0.0, 0.0], None));
        assert!(zoned_at(&[paint, erase], [1.5, 0.0, 0.0], None));
        assert!(!zoned_at(&[paint], [0.0, 0.0, 0.0], Some([0.0, -1.0, 0.0])));
    }
}
