//! Vector helpers on plain tuples. `V3` is double precision (plate space, millimetres); the float
//! operation order mirrors src/core/vec3.ts so TypeScript and Rust agree to the last bit, and
//! `length` is `Math.hypot`. `single` holds the single-precision helpers of the Blender-parity code.

use super::jsnum::hypot3;

pub type V3 = [f64; 3];

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
pub fn distance(a: V3, b: V3) -> f64 {
    hypot3(sub(a, b))
}
/// Unit vector, or `fallback` for a zero-length one (TS `normalize`).
pub fn normalize_or(v: V3, fallback: V3) -> V3 {
    let size = length(v);
    if size == 0.0 { fallback } else { [v[0] / size, v[1] / size, v[2] / size] }
}
/// Unit vector; a zero-length input stays `[0, 0, 0]`.
pub fn normalize(v: V3) -> V3 {
    normalize_or(v, [0.0; 3])
}
/// Unit vector, or straight down (plate frame, Y up) for a zero-length one.
pub fn normalize_or_down(v: V3) -> V3 {
    normalize_or(v, [0.0, -1.0, 0.0])
}

/// Single precision, as Blender computes it.
pub mod single {
    pub type V3f = [f32; 3];

    /// Squared lengths at or below this normalise to zero.
    pub const TINY: f32 = 1e-35;

    pub fn dot(a: V3f, b: V3f) -> f32 {
        a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    }
    pub fn sub(a: V3f, b: V3f) -> V3f {
        [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    }
    /// Unit vector by division by the length; zero when (nearly) zero.
    pub fn normalize(v: V3f) -> V3f {
        let length_sq = dot(v, v);
        if !(length_sq > TINY) {
            return [0.0; 3];
        }
        let length = length_sq.sqrt();
        [v[0] / length, v[1] / length, v[2] / length]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_vector_normalizes_to_down_or_zero() {
        assert_eq!(normalize_or_down([0.0; 3]), [0.0, -1.0, 0.0]);
        assert_eq!(normalize([0.0; 3]), [0.0; 3]);
        assert_eq!(normalize_or_down([0.0, 3.0, 4.0]), [0.0, 0.6, 0.8]);
        assert_eq!(cross([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), [0.0, 0.0, 1.0]);
    }

    #[test]
    fn single_precision_normalize_drops_tiny_vectors() {
        assert_eq!(single::normalize([0.0, 3.0, 4.0]), [0.0, 0.6, 0.8]);
        assert_eq!(single::normalize([1e-20, 0.0, 0.0]), [0.0; 3]);
    }
}
