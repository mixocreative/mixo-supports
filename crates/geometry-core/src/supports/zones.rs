//! No-support zones: brush dabs painted on the model (unit-local data the host serialises). The
//! last stamp covering a point decides (paint zones, erase clears).

use crate::core::vec::V3;

/// One brush dab of a no-support zone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ZoneStamp {
    pub center: V3,
    /// Surface normal under the brush; keeps the far side of a thin wall out of the zone.
    pub normal: V3,
    pub radius: f64,
    /// Paint (true) or erase (false).
    pub paint: bool,
}

/// Whether `point` is zoned: the last stamp covering it decides.
pub fn zoned_at(zones: &[ZoneStamp], point: V3, normal: Option<V3>) -> bool {
    for stamp in zones.iter().rev() {
        let (dx, dy, dz) = (point[0] - stamp.center[0], point[1] - stamp.center[1], point[2] - stamp.center[2]);
        if dx * dx + dy * dy + dz * dz > stamp.radius * stamp.radius {
            continue;
        }
        if let Some(n) = normal {
            if n[0] * stamp.normal[0] + n[1] * stamp.normal[1] + n[2] * stamp.normal[2] <= 0.0 {
                continue;
            }
        }
        return stamp.paint;
    }
    false
}

/// Flat stamps: `ZONE_STRIDE` f64 each: center xyz, normal xyz, radius, kind (1 paint, 0 erase).
pub const ZONE_STRIDE: usize = 8;

pub fn decode_zones(values: &[f64]) -> Option<Vec<ZoneStamp>> {
    if values.len() % ZONE_STRIDE != 0 || values.iter().any(|v| !v.is_finite()) {
        return None;
    }
    Some(
        values
            .chunks_exact(ZONE_STRIDE)
            .map(|v| ZoneStamp { center: [v[0], v[1], v[2]], normal: [v[3], v[4], v[5]], radius: v[6], paint: v[7] == 1.0 })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_covering_stamp_wins_and_the_far_side_is_left_out() {
        let paint = ZoneStamp { center: [0.0; 3], normal: [0.0, 1.0, 0.0], radius: 2.0, paint: true };
        let erase = ZoneStamp { paint: false, radius: 1.0, ..paint };
        assert!(zoned_at(&[paint], [1.5, 0.0, 0.0], Some([0.0, 1.0, 0.0])));
        assert!(!zoned_at(&[paint, erase], [0.5, 0.0, 0.0], None));
        assert!(zoned_at(&[paint, erase], [1.5, 0.0, 0.0], None));
        assert!(!zoned_at(&[paint], [0.0, 0.0, 0.0], Some([0.0, -1.0, 0.0])));
    }
}
