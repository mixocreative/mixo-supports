//! Exact triangle tests in one millimetre frame (port of TS `triangleIntersection.ts`; the
//! operation order is kept so hits agree with the oracle to the last bit).

use crate::supports::parts::vec::{V3, cross, dot, sub};

pub type Tri = [V3; 3];

const EPS: f64 = 1e-8;

fn hypot(v: V3) -> f64 {
    crate::supports::remesh::hypot3(v)
}

/// Position along a non-coplanar segment when its centre line intersects a triangle.
pub fn segment_triangle_hit(from: V3, to: V3, tri: &Tri) -> Option<f64> {
    let [a, b, c] = *tri;
    let normal = cross(sub(b, a), sub(c, a));
    let direction = sub(to, from);
    let denominator = dot(normal, direction);
    if denominator.abs() < EPS {
        return None;
    }
    let t = dot(normal, sub(a, from)) / denominator;
    if !(t >= -EPS && t <= 1.0 + EPS) {
        return None;
    }
    let point = [from[0] + t * direction[0], from[1] + t * direction[1], from[2] + t * direction[2]];
    let inside = dot(normal, cross(sub(b, a), sub(point, a))) >= -EPS
        && dot(normal, cross(sub(c, b), sub(point, b))) >= -EPS
        && dot(normal, cross(sub(a, c), sub(point, c))) >= -EPS;
    inside.then(|| t.clamp(0.0, 1.0))
}

type P2 = [f64; 2];

fn orient(p: P2, q: P2, r: P2) -> f64 {
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
}

fn within(p: P2, q: P2, r: P2) -> bool {
    r[0] >= p[0].min(q[0]) - EPS && r[0] <= p[0].max(q[0]) + EPS && r[1] >= p[1].min(q[1]) - EPS && r[1] <= p[1].max(q[1]) + EPS
}

fn edges_intersect(p: P2, q: P2, r: P2, s: P2) -> bool {
    let (o1, o2, o3, o4) = (orient(p, q, r), orient(p, q, s), orient(r, s, p), orient(r, s, q));
    (o1 * o2 < 0.0 && o3 * o4 < 0.0)
        || (o1.abs() <= EPS && within(p, q, r))
        || (o2.abs() <= EPS && within(p, q, s))
        || (o3.abs() <= EPS && within(r, s, p))
        || (o4.abs() <= EPS && within(r, s, q))
}

fn contains(tri: &[P2; 3], point: P2) -> bool {
    let signs: Vec<f64> = (0..3).map(|i| orient(tri[i], tri[(i + 1) % 3], point)).collect();
    signs.iter().all(|&v| v >= -EPS) || signs.iter().all(|&v| v <= EPS)
}

fn coplanar_overlap(a: &Tri, b: &Tri) -> bool {
    let normal = cross(sub(a[1], a[0]), sub(a[2], a[0]));
    let size = hypot(normal);
    if size < EPS || dot(normal, sub(b[0], a[0])).abs() > EPS * size {
        return false;
    }
    let other = cross(sub(b[1], b[0]), sub(b[2], b[0]));
    let other_size = hypot(other);
    if other_size < EPS || hypot(cross(normal, other)) > EPS * size * other_size {
        return false;
    }
    let mut omit = 0;
    for axis in 0..3 {
        if normal[axis].abs() > normal[omit].abs() {
            omit = axis;
        }
    }
    let axes: Vec<usize> = (0..3).filter(|&axis| axis != omit).collect();
    let project = |p: V3| [p[axes[0]], p[axes[1]]];
    let left = [project(a[0]), project(a[1]), project(a[2])];
    let right = [project(b[0]), project(b[1]), project(b[2])];
    for i in 0..3 {
        for j in 0..3 {
            if edges_intersect(left[i], left[(i + 1) % 3], right[j], right[(j + 1) % 3]) {
                return true;
            }
        }
    }
    contains(&left, right[0]) || contains(&right, left[0])
}

pub fn triangles_intersect(left: &Tri, right: &Tri) -> bool {
    for edge in 0..3 {
        if segment_triangle_hit(left[edge], left[(edge + 1) % 3], right).is_some() || segment_triangle_hit(right[edge], right[(edge + 1) % 3], left).is_some() {
            return true;
        }
    }
    coplanar_overlap(left, right)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crossing_and_separate_triangles() {
        let flat: Tri = [[0.0, 0.0, 0.0], [4.0, 0.0, 0.0], [0.0, 0.0, 4.0]];
        let piercing: Tri = [[1.0, -1.0, 1.0], [1.5, 1.0, 1.0], [1.0, 1.0, 1.5]];
        let apart: Tri = [[1.0, 2.0, 1.0], [1.5, 3.0, 1.0], [1.0, 3.0, 1.5]];
        assert!(triangles_intersect(&flat, &piercing));
        assert!(!triangles_intersect(&flat, &apart));
    }

    #[test]
    fn coplanar_overlap_counts_and_a_parallel_gap_does_not() {
        let a: Tri = [[0.0, 0.0, 0.0], [4.0, 0.0, 0.0], [0.0, 0.0, 4.0]];
        let b: Tri = [[1.0, 0.0, 1.0], [5.0, 0.0, 1.0], [1.0, 0.0, 5.0]];
        let c: Tri = [[1.0, 0.5, 1.0], [5.0, 0.5, 1.0], [1.0, 0.5, 5.0]];
        assert!(triangles_intersect(&a, &b));
        assert!(!triangles_intersect(&a, &c));
    }

    #[test]
    fn segment_hit_parameter_is_along_the_segment() {
        let tri: Tri = [[0.0, 0.0, 0.0], [4.0, 0.0, 0.0], [0.0, 0.0, 4.0]];
        let t = segment_triangle_hit([1.0, 2.0, 1.0], [1.0, -2.0, 1.0], &tri).unwrap();
        assert!((t - 0.5).abs() < 1e-12);
        assert!(segment_triangle_hit([5.0, 2.0, 5.0], [5.0, -2.0, 5.0], &tri).is_none());
    }
}
