//! Plan-view (x, z) helpers the raft, roof and label share: JS-compatible `hypot`, polygon area,
//! even-odd containment, closed-curve resampling and Blender's Face Corner Angle bisectors.

pub type P2 = [f64; 2];

/// `Math.hypot` as V8 computes it (scaled by the largest term, Kahan-summed), so plan geometry
/// built from it agrees with the TS oracle to the last bit.
pub fn js_hypot(values: &[f64]) -> f64 {
    let max = values.iter().fold(0.0_f64, |m, v| m.max(v.abs()));
    if max == 0.0 || !max.is_finite() {
        return max;
    }
    let (mut sum, mut compensation) = (0.0_f64, 0.0_f64);
    for v in values {
        let n = v.abs() / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

pub fn area(loop_: &[P2]) -> f64 {
    let mut sum = 0.0;
    for (index, point) in loop_.iter().enumerate() {
        let next = loop_[(index + 1) % loop_.len()];
        sum += point[0] * next[1] - next[0] * point[1];
    }
    sum / 2.0
}

/// Even-odd point in polygon.
pub fn inside(p: P2, polygon: &[P2]) -> bool {
    let [x, z] = p;
    let mut result = false;
    let mut j = polygon.len().wrapping_sub(1);
    for i in 0..polygon.len() {
        let [xi, zi] = polygon[i];
        let [xj, zj] = polygon[j];
        if (zi > z) != (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi {
            result = !result;
        }
        j = i;
    }
    result
}

pub fn normalize2(v: P2) -> P2 {
    let length = js_hypot(&v);
    if length == 0.0 { [0.0, 0.0] } else { [v[0] / length, v[1] / length] }
}

/// Blender Resample Curve (Count) on a cyclic poly curve: points evenly spaced by length from the first point.
pub fn resample_closed(loop_: &[P2], count: usize) -> Vec<P2> {
    let n = loop_.len();
    let lengths: Vec<f64> = (0..n)
        .map(|i| {
            let (a, b) = (loop_[i], loop_[(i + 1) % n]);
            js_hypot(&[b[0] - a[0], b[1] - a[1]])
        })
        .collect();
    let total: f64 = lengths.iter().sum();
    let mut out = Vec::with_capacity(count);
    let (mut segment, mut start) = (0usize, 0.0_f64);
    for k in 0..count {
        let target = (k as f64 / count as f64) * total;
        while segment < n - 1 && start + lengths[segment] < target {
            start += lengths[segment];
            segment += 1;
        }
        let (a, b) = (loop_[segment], loop_[(segment + 1) % n]);
        let t = if lengths[segment] == 0.0 { 0.0 } else { (target - start) / lengths[segment] };
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out
}

/// Blender Face Corner Angle bisector at each corner, in web (x, z): the next-edge direction
/// rotated about the n-gon normal by half the interior angle (reflex corners handled).
pub fn corner_bisectors(polygon: &[P2]) -> Vec<P2> {
    let plan: Vec<P2> = polygon.iter().map(|&[x, z]| [x, -z]).collect();
    let up = if area(&plan) >= 0.0 { 1.0 } else { -1.0 };
    let n = plan.len();
    (0..n)
        .map(|index| {
            let point = plan[index];
            let (previous, next) = (plan[(index + n - 1) % n], plan[(index + 1) % n]);
            let a = normalize2([previous[0] - point[0], previous[1] - point[1]]);
            let b = normalize2([next[0] - point[0], next[1] - point[1]]);
            let mut angle = (a[0] * b[0] + a[1] * b[1]).clamp(-1.0, 1.0).acos();
            if (a[0] * b[1] - a[1] * b[0]) * up > 0.0 {
                angle = 2.0 * std::f64::consts::PI - angle;
            }
            let half = (angle / 2.0) * up;
            let rx = b[0] * half.cos() - b[1] * half.sin();
            let ry = b[0] * half.sin() + b[1] * half.cos();
            [rx, -ry]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypot_matches_the_pythagorean_triples() {
        assert_eq!(js_hypot(&[3.0, 4.0]), 5.0);
        assert_eq!(js_hypot(&[0.0, 0.0]), 0.0);
        assert!((js_hypot(&[1.0, 2.0, 2.0]) - 3.0).abs() < 1e-15);
    }

    #[test]
    fn resample_keeps_the_start_and_spreads_evenly() {
        let square: Vec<P2> = vec![[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]];
        let r = resample_closed(&square, 8);
        assert_eq!(r[0], [0.0, 0.0]);
        assert_eq!(r[1], [1.0, 0.0]);
        assert_eq!(r[2], [2.0, 0.0]);
    }

    #[test]
    fn bisector_of_a_square_corner_points_along_the_diagonal() {
        let square: Vec<P2> = vec![[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]];
        let b = corner_bisectors(&square);
        assert!((b[0][0].abs() - b[0][1].abs()).abs() < 1e-12);
        assert!((js_hypot(&b[0]) - 1.0).abs() < 1e-12);
    }
}
