//! Automatic contact IDs encode the contact position on a 0.01 mm grid, like Blender removed-point
//! markers: a deletion keeps hiding the same spot after any regeneration and simply stops matching
//! when that spot is no longer sampled.

use crate::core::jsnum::js_round;

/// `auto-X_Y_Z` with each coordinate rounded to 0.01 mm (JS `Math.round`, ties toward +infinity).
pub fn position_id(position: [f64; 3]) -> String {
    let part = |v: f64| format!("{}", js_round(v * 100.0) as i64);
    format!("auto-{}_{}_{}", part(position[0]), part(position[1]), part(position[2]))
}

/// Position encoded in an automatic contact ID (0.01 mm grid), if it is one.
pub fn position_from_id(id: &str) -> Option<[f64; 3]> {
    let rest = id.strip_prefix("auto-")?;
    let mut out = [0.0; 3];
    let mut parts = rest.split('_');
    for slot in &mut out {
        let text = parts.next()?;
        let digits = text.strip_prefix('-').unwrap_or(text);
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *slot = text.parse::<f64>().ok()? / 100.0;
    }
    parts.next().is_none().then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip_on_the_grid_and_round_half_up() {
        assert_eq!(position_id([1.234, -0.005, 0.0]), "auto-123_0_0");
        assert_eq!(position_id([-0.0051, 2.5, 10.0]), "auto--1_250_1000");
        assert_eq!(position_from_id("auto--1_250_1000"), Some([-0.01, 2.5, 10.0]));
        assert_eq!(position_from_id("manual-3"), None);
        assert_eq!(position_from_id("auto-1_2"), None);
        assert_eq!(position_from_id("auto-1_2_3_4"), None);
    }
}
