//! 3D tuple helpers (plate space, millimetres). The floating-point operation order mirrors
//! src/core/vec3.ts so TS and Rust agree to the last bit where the arithmetic is exact.

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
pub fn length(v: V3) -> f64 {
    dot(v, v).sqrt()
}
/// Unit vector, or straight down (plate frame, Y up) for a zero-length one.
pub fn normalize_or_down(v: V3) -> V3 {
    let size = length(v);
    if size == 0.0 { [0.0, -1.0, 0.0] } else { [v[0] / size, v[1] / size, v[2] / size] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_vector_normalizes_to_down() {
        assert_eq!(normalize_or_down([0.0; 3]), [0.0, -1.0, 0.0]);
        assert_eq!(normalize_or_down([0.0, 3.0, 4.0]), [0.0, 0.6, 0.8]);
        assert_eq!(cross([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), [0.0, 0.0, 1.0]);
    }
}
