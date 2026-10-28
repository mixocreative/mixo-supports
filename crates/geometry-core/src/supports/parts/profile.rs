//! Cross-section profiles and ring generation shared by every swept part.

use crate::core::vec::{V3, add, cross, normalize_or_down, scale};
use crate::supports::settings::TipSection;
use std::f64::consts::PI;

pub type P2 = [f64; 2];

/// Unit tip profile (radius 1) in the tube's normal / binormal plane, counter-clockwise: a square
/// of side diameter, or a cross of two plates `cross_width` % of the diameter wide.
pub fn tip_profile(section: TipSection, cross_width: f64) -> Vec<P2> {
    if section == TipSection::Square {
        return vec![[1.0, 1.0], [-1.0, 1.0], [-1.0, -1.0], [1.0, -1.0]];
    }
    let a = cross_width / 100.0;
    vec![
        [1.0, a], [a, a], [a, 1.0], [-a, 1.0], [-a, a], [-1.0, a],
        [-1.0, -a], [-a, -a], [-a, -1.0], [a, -1.0], [a, -a], [1.0, -a],
    ]
}

/// Two unit vectors perpendicular to `axis` and to each other.
pub fn basis(axis: V3) -> (V3, V3) {
    let helper: V3 = if axis[1].abs() < 0.9 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
    let u = normalize_or_down(cross(helper, axis));
    (u, cross(axis, u))
}

/// Circle of `segments` points of `radius` around `center` in the plane spanned by `u` and `v`.
pub fn circle_ring(center: V3, u: V3, v: V3, radius: f64, segments: usize) -> Vec<V3> {
    (0..segments)
        .map(|step| {
            let angle = (step as f64 / segments as f64) * PI * 2.0;
            add(center, add(scale(u, angle.cos() * radius), scale(v, angle.sin() * radius)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_and_cross_profiles_have_the_expected_corners() {
        assert_eq!(tip_profile(TipSection::Square, 40.0).len(), 4);
        let cross = tip_profile(TipSection::Cross, 40.0);
        assert_eq!(cross.len(), 12);
        assert_eq!(cross[0], [1.0, 0.4]);
    }

    #[test]
    fn basis_is_orthonormal() {
        let (u, v) = basis(normalize_or_down([0.3, -0.9, 0.1]));
        assert!(crate::core::vec::dot(u, v).abs() < 1e-12);
        assert!((crate::core::vec::length(u) - 1.0).abs() < 1e-12);
    }
}
