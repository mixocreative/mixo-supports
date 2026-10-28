//! Number helpers that reproduce JavaScript arithmetic exactly, so Rust agrees with the TypeScript
//! goldens to the last bit: `Math.fround`, V8's `Math.hypot` and `Math.round`.

/// `Math.fround`: round to the nearest single-precision value.
#[inline]
pub fn fr(x: f64) -> f64 {
    f64::from(x as f32)
}

/// V8's `Math.hypot` of any number of arguments (scaled by the largest term, Kahan-summed), which
/// differs from `sqrt(x*x + y*y + z*z)` in the last bit. Any infinite argument gives infinity even
/// beside a NaN; otherwise a NaN argument gives NaN (the order the ECMAScript spec fixes).
pub fn hypot(values: &[f64]) -> f64 {
    let mut max = 0.0f64;
    let mut has_nan = false;
    for v in values {
        if v.is_nan() {
            has_nan = true;
        } else {
            max = max.max(v.abs());
        }
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if has_nan {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for v in values {
        let n = v.abs() / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// `Math.hypot(v[0], v[1], v[2])`.
pub fn hypot3(v: [f64; 3]) -> f64 {
    hypot(&v)
}

/// `Math.round`: ties go toward +infinity.
pub fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_round_ties_go_up() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-0.4), -0.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
    }

    #[test]
    fn hypot_matches_exact_cases() {
        assert_eq!(hypot3([3.0, 4.0, 0.0]), 5.0);
        assert_eq!(hypot3([0.0; 3]), 0.0);
        assert_eq!(hypot(&[3.0, 4.0]), 5.0);
        assert!((hypot(&[1.0, 2.0, 2.0]) - 3.0).abs() < 1e-15);
    }

    #[test]
    fn hypot_special_values_follow_javascript() {
        assert!(hypot(&[f64::NAN, 1.0]).is_nan());
        assert_eq!(hypot(&[f64::NAN, f64::INFINITY]), f64::INFINITY);
        assert_eq!(hypot(&[f64::NEG_INFINITY, 1.0]), f64::INFINITY);
    }
}
