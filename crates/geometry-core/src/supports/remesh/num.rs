//! Number helpers that reproduce the TypeScript oracle's arithmetic: single-precision rounding
//! between double-precision steps (`Math.fround`), V8's `Math.hypot` and `Math.round`.

pub type V3 = [f64; 3];

/// `Math.fround`: round to the nearest single-precision value.
#[inline]
pub fn fr(x: f64) -> f64 {
    f64::from(x as f32)
}

/// V8's `Math.hypot` of any number of arguments (scaled, Kahan-summed), which differs from
/// `sqrt(x*x + y*y + z*z)` in the last bit.
pub fn hypot(values: &[f64]) -> f64 {
    let mut max = 0.0f64;
    for v in values {
        if v.is_nan() {
            return f64::NAN;
        }
        max = max.max(v.abs());
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
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

pub fn hypot3(v: V3) -> f64 {
    hypot(&v)
}

/// `Math.round`: ties go toward +infinity.
pub fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn scale(v: V3, s: f64) -> V3 {
    [v[0] * s, v[1] * s, v[2] * s]
}
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
/// `Math.hypot` length (the TS `length`).
pub fn length(v: V3) -> f64 {
    hypot3(v)
}
/// Unit vector, or `fallback` for a zero-length one (TS `normalize`).
pub fn normalize(v: V3, fallback: V3) -> V3 {
    let size = length(v);
    if size == 0.0 { fallback } else { [v[0] / size, v[1] / size, v[2] / size] }
}
pub fn normalize_or_down(v: V3) -> V3 {
    normalize(v, [0.0, -1.0, 0.0])
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
    }
}
