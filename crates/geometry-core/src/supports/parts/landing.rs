//! Where a support column lands and how its neck leans. Landing hits come from `model.rs`
//! (exact surface) or, until the voxel remesh is ported (U5), from the caller.

use super::vec::{V3, add, normalize_or_down, scale, sub};

/// A point where a support lands on the model, with the landed-on surface normal (pointing up).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Landing {
    pub point: V3,
    pub normal: V3,
    /// Face hit on the exact source mesh.
    pub face: Option<u32>,
    /// Exact hit on that face.
    pub source_point: Option<V3>,
}

/// `to` moved `depth` further along the direction from `from` to `to`.
pub fn sink_into(from: V3, to: V3, depth: f64) -> V3 {
    add(to, scale(normalize_or_down(sub(to, from)), depth))
}

/// The neck follows the surface normal but tilts at most `max_angle` degrees from straight down.
pub fn neck_direction(normal: V3, max_angle: f64) -> V3 {
    let angle = (-normal[1]).clamp(-1.0, 1.0).acos();
    let limit = max_angle * std::f64::consts::PI / 180.0;
    if angle <= limit {
        return normal;
    }
    let horizontal = crate::supports::remesh::hypot(&[normal[0], normal[2]]);
    if horizontal < 1e-9 {
        return [0.0, -1.0, 0.0];
    }
    let sin = limit.sin();
    [normal[0] / horizontal * sin, -limit.cos(), normal[2] / horizontal * sin]
}

/// Up-facing counterpart of `neck_direction`, used for inverted necks landing on the model.
pub fn up_direction(normal: V3, max_angle: f64) -> V3 {
    let flipped = neck_direction([-normal[0], -normal[1], -normal[2]], max_angle);
    [-flipped[0], -flipped[1], -flipped[2]]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neck_follows_the_normal_within_the_limit_and_tilts_at_most_the_limit() {
        assert_eq!(neck_direction([0.0, -1.0, 0.0], 45.0), [0.0, -1.0, 0.0]);
        let steep = neck_direction([1.0, -0.1, 0.0], 45.0);
        assert!((steep[1] + 45f64.to_radians().cos()).abs() < 1e-12 && steep[0] > 0.0);
        assert_eq!(neck_direction([0.0, 1.0, 0.0], 45.0), [0.0, -1.0, 0.0]);
    }

    #[test]
    fn sink_moves_past_the_target() {
        assert_eq!(sink_into([0.0, 1.0, 0.0], [0.0, 0.0, 0.0], 0.2), [0.0, -0.2, 0.0]);
    }
}
