//! Queries on the remesh: landing rays, neck normals, polygons near a column (the Safe Distance
//! scatter) and vertex normals.

use super::grid::{Idx, Remesh, leaf_of};
use crate::core::vec::{V3, add, dot, length, normalize_or_down, scale, sub};
use super::{LEAF, PointId, Polygon};
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NormalKind {
    Face,
    Edge,
}

/// Blender triangulates quads along the 0-2 diagonal.
pub fn fan(corners: &[V3]) -> Vec<[V3; 3]> {
    (1..corners.len() - 1).map(|k| [corners[0], corners[k], corners[k + 1]]).collect()
}

/// Height where the vertical line through `p` meets triangle abc (the non-strict test).
fn vertical_hit(p: V3, a: V3, b: V3, c: V3) -> Option<f64> {
    let det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if det.abs() < 1e-12 {
        return None;
    }
    let l1 = ((b[2] - c[2]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[2] - c[2])) / det;
    let l2 = ((c[2] - a[2]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[2] - c[2])) / det;
    let l3 = 1.0 - l1 - l2;
    if l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9 {
        return None;
    }
    Some(l1 * a[1] + l2 * b[1] + l3 * c[1])
}

fn triangle_distance(p: V3, a: V3, b: V3, c: V3) -> f64 {
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ap = sub(p, a);
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return length(ap);
    }
    let bp = sub(p, b);
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if d3 >= 0.0 && d4 <= d3 {
        return length(bp);
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return length(sub(p, add(a, scale(ab, d1 / (d1 - d3)))));
    }
    let cp = sub(p, c);
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if d6 >= 0.0 && d5 <= d6 {
        return length(cp);
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return length(sub(p, add(a, scale(ac, d2 / (d2 - d6)))));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
        return length(sub(p, add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))))));
    }
    let denominator = 1.0 / (va + vb + vc);
    length(sub(p, add(a, add(scale(ab, vb * denominator), scale(ac, vc * denominator)))))
}

fn segment_distance(p: V3, a: V3, b: V3) -> f64 {
    let ab = sub(b, a);
    let t = (dot(sub(p, a), ab) / dot(ab, ab).max(1e-12)).clamp(0.0, 1.0).max(0.0);
    length(sub(p, add(a, scale(ab, t))))
}

fn floor_div(value: f64, size: f64) -> i32 {
    (value / size).floor() as i32
}

impl Remesh {
    /// Polygons from leaves near the vertical line through (x, z), between web heights `top` and `bottom`.
    pub fn polygons_near_column(&mut self, x: f64, z: f64, radius: f64, top: f64, bottom: f64) -> Vec<Rc<Polygon>> {
        let h = self.voxel;
        let leaf_range = |lo: f64, hi: f64| ((lo / h).floor() as i32).div_euclid(LEAF) - 1..=((hi / h).floor() as i32).div_euclid(LEAF) + 1;
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Rc<Polygon>> = Vec::new();
        let (xs, zs, ys) = (leaf_range(x - radius, x + radius), leaf_range(-z - radius, -z + radius), leaf_range(bottom.max(self.bottom), top));
        for i in xs {
            for j in zs.clone() {
                for k in ys.clone() {
                    for polygon in self.leaf_polygons([i * LEAF, j * LEAF, k * LEAF]).iter() {
                        if seen.insert(polygon.id) {
                            out.push(polygon.clone());
                        }
                    }
                }
            }
        }
        out
    }

    fn polygons_near(&mut self, point: V3) -> Vec<Rc<Polygon>> {
        let h = self.voxel;
        let b: Idx = [(point[0] / h).floor() as i32, (-point[2] / h).floor() as i32, (point[1] / h).floor() as i32];
        let origin = leaf_of(b);
        // A polygon's points lie in the leaf that owns its edge or the leaf below it, so polygons
        // near b come from b's leaf and the next one up, plus the outer neighbours when b sits
        // within two cells of a leaf face.
        let offsets: Vec<Vec<i32>> = (0..3)
            .map(|axis| {
                let local = b[axis] - origin[axis];
                let mut o = Vec::new();
                if local < 2 {
                    o.push(-1);
                }
                o.extend([0, 1]);
                if local >= LEAF - 2 {
                    o.push(2);
                }
                o
            })
            .collect();
        let mut out = Vec::new();
        for &i in &offsets[0] {
            for &j in &offsets[1] {
                for &k in &offsets[2] {
                    out.extend(self.leaf_polygons([origin[0] + i * LEAF, origin[1] + j * LEAF, origin[2] + k * LEAF]).iter().cloned());
                }
            }
        }
        out
    }

    /// Face normal of the nearest remesh face (`Face` points) or nearest-edge normal (`Edge` points).
    pub fn normal_at(&mut self, point: V3, kind: NormalKind) -> Option<V3> {
        let polygons = self.polygons_near(point);
        if polygons.is_empty() {
            return None;
        }
        if kind == NormalKind::Face {
            let mut best: Option<&Rc<Polygon>> = None;
            let mut best_distance = f64::INFINITY;
            for polygon in &polygons {
                let d = fan(&polygon.corners).iter().map(|[a, b, c]| triangle_distance(point, *a, *b, *c)).fold(f64::INFINITY, f64::min);
                if d < best_distance {
                    best_distance = d;
                    best = Some(polygon);
                }
            }
            return best.map(|p| p.normal);
        }
        // Nearest edge; Blender's edge normal is the mean of its two vertex normals.
        let mut best_edge: Option<(PointId, PointId)> = None;
        let mut best_distance = f64::INFINITY;
        for polygon in &polygons {
            let n = polygon.corners.len();
            for (k, corner) in polygon.corners.iter().enumerate() {
                let d = segment_distance(point, *corner, polygon.corners[(k + 1) % n]);
                if d < best_distance {
                    best_distance = d;
                    best_edge = Some((polygon.vertices[k], polygon.vertices[(k + 1) % n]));
                }
            }
        }
        let (a, b) = best_edge?;
        let (na, nb) = (self.vertex_normal(a, &|_| true), self.vertex_normal(b, &|_| true));
        Some(normalize_or_down(add(na, nb)))
    }

    /// Blender vertex normal: face normals weighted by the corner angle (zero-length sides skipped),
    /// over the polygons that `keep` admits (the faces of a separated mesh).
    pub fn vertex_normal(&mut self, id: PointId, keep: &dyn Fn(&Polygon) -> bool) -> V3 {
        let mut sum = [0.0; 3];
        for polygon in self.star(id) {
            if !keep(&polygon) {
                continue;
            }
            let n = polygon.corners.len();
            for (k, vertex) in polygon.vertices.iter().enumerate() {
                if *vertex != id {
                    continue;
                }
                let here = polygon.corners[k];
                let a = sub(polygon.corners[(k + n - 1) % n], here);
                let b = sub(polygon.corners[(k + 1) % n], here);
                if length(a) < 1e-9 || length(b) < 1e-9 {
                    continue;
                }
                let angle = (dot(a, b) / (length(a) * length(b))).clamp(-1.0, 1.0).acos();
                sum = add(sum, scale(polygon.normal, angle));
            }
        }
        normalize_or_down(sum)
    }

    /// First remesh surface straight below `from` within `length`, with its upward normal. The scan
    /// starts at height `start` (a caller that knows nothing lies above it can skip cells).
    pub fn cast_down(&mut self, from: V3, length: f64, start: f64) -> Option<(V3, V3)> {
        let h = self.voxel;
        let li = floor_div(from[0], h).div_euclid(LEAF);
        let lj = floor_div(-from[2], h).div_euclid(LEAF);
        let mut best: Option<(V3, V3)> = None;
        let top = floor_div(start.min(from[1]), h).div_euclid(LEAF) + 1;
        let lowest = floor_div((from[1] - length).max(self.bottom), h).div_euclid(LEAF) - 1;
        let mut lk = top;
        while lk >= lowest {
            for di in -1..=1 {
                for dj in -1..=1 {
                    let polygons = self.leaf_polygons([(li + di) * LEAF, (lj + dj) * LEAF, lk * LEAF]);
                    for polygon in polygons.iter() {
                        for [a, b, c] in fan(&polygon.corners) {
                            let Some(hit) = vertical_hit(from, a, b, c) else { continue };
                            if hit >= from[1] - 1e-6 || from[1] - hit > length {
                                continue;
                            }
                            if best.is_none_or(|(p, _)| hit > p[1]) {
                                let normal = if polygon.normal[1] < 0.0 { scale(polygon.normal, -1.0) } else { polygon.normal };
                                best = Some(([from[0], hit, from[2]], normal));
                            }
                        }
                    }
                }
            }
            // Polygons of a leaf reach at most one leaf beyond it.
            if best.is_some_and(|(p, _)| p[1] > f64::from(lk * LEAF + 2 * LEAF) * h) {
                break;
            }
            lk -= 1;
        }
        best
    }

    /// Vertex positions (web) of the polygons of the leaves overlapping a web-space box.
    pub fn vertices_in_box(&mut self, min: V3, max: V3) -> Vec<V3> {
        let mut out: Vec<(PointId, V3)> = Vec::new();
        let radius = (max[0] - min[0]).max(max[2] - min[2]) / 2.0;
        for polygon in self.polygons_near_column((min[0] + max[0]) / 2.0, (min[2] + max[2]) / 2.0, radius, max[1], min[1]) {
            for (k, id) in polygon.vertices.iter().enumerate() {
                match out.iter_mut().find(|(i, _)| i == id) {
                    Some(slot) => slot.1 = polygon.corners[k],
                    None => out.push((*id, polygon.corners[k])),
                }
            }
        }
        out.into_iter().map(|(_, p)| p).collect()
    }
}
