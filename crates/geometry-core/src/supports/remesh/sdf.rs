//! Signed distance to a closed mesh (negative inside) and nearest-surface queries: nearest
//! triangle through a bounding volume hierarchy, sign from the parity of an upward ray. Port of the
//! TS `SignedDistance`; the triangle order and tie-breaking follow it.

use crate::core::vec::{V3, add, dot, scale, sub};

#[derive(Default)]
pub struct SignedDistance {
    tris: Vec<f64>,
    order: Vec<u32>,
    /// Per node: min xyz, max xyz.
    boxes: Vec<f64>,
    /// Per node: left child (-1 for a leaf), right child, first triangle, triangle count.
    links: Vec<i32>,
}

impl SignedDistance {
    /// `positions` xyz triples (single precision), `indices` triangle corners.
    pub fn new(positions: &[f32], indices: &[u32]) -> Self {
        let count = indices.len() / 3;
        let mut tris = vec![0.0; count * 9];
        for face in 0..count {
            for k in 0..3 {
                let i = indices[face * 3 + k] as usize * 3;
                for axis in 0..3 {
                    tris[face * 9 + k * 3 + axis] = f64::from(positions[i + axis]);
                }
            }
        }
        let mut me = Self { tris, order: Vec::new(), boxes: Vec::new(), links: Vec::new() };
        if count > 0 {
            me.build((0..count as u32).collect());
        }
        me
    }

    fn centroid(&self, f: u32, axis: usize) -> f64 {
        let t = &self.tris;
        let f = f as usize;
        (t[f * 9 + axis] + t[f * 9 + 3 + axis] + t[f * 9 + 6 + axis]) / 3.0
    }

    fn build(&mut self, mut list: Vec<u32>) -> i32 {
        let node = (self.links.len() / 4) as i32;
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        for &f in &list {
            for v in 0..3 {
                for axis in 0..3 {
                    let value = self.tris[f as usize * 9 + v * 3 + axis];
                    if value < min[axis] {
                        min[axis] = value;
                    }
                    if value > max[axis] {
                        max[axis] = value;
                    }
                }
            }
        }
        self.boxes.extend_from_slice(&min);
        self.boxes.extend_from_slice(&max);
        self.links.extend_from_slice(&[-1, -1, self.order.len() as i32, list.len() as i32]);
        if list.len() <= 4 {
            self.order.extend_from_slice(&list);
            return node;
        }
        let mut axis = 0;
        let mut spread = -1.0;
        for a in 0..3 {
            let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
            for &f in &list {
                let c = self.centroid(f, a);
                if c < lo {
                    lo = c;
                }
                if c > hi {
                    hi = c;
                }
            }
            if hi - lo > spread {
                spread = hi - lo;
                axis = a;
            }
        }
        // Stable sort on the centroid, like `Array.prototype.sort` with a difference comparator.
        let this = &*self;
        list.sort_by(|&x, &y| (this.centroid(x, axis) - this.centroid(y, axis)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        let half = list.len() >> 1;
        let right_list = list.split_off(half);
        let left = self.build(list);
        let right = self.build(right_list);
        self.links[node as usize * 4] = left;
        self.links[node as usize * 4 + 1] = right;
        self.links[node as usize * 4 + 3] = 0;
        node
    }

    fn box_distance_sq(&self, node: i32, x: f64, y: f64, z: f64) -> f64 {
        let b = node as usize * 6;
        let dx = (self.boxes[b] - x).max(0.0).max(x - self.boxes[b + 3]);
        let dy = (self.boxes[b + 1] - y).max(0.0).max(y - self.boxes[b + 4]);
        let dz = (self.boxes[b + 2] - z).max(0.0).max(z - self.boxes[b + 5]);
        dx * dx + dy * dy + dz * dz
    }

    /// Nearest triangle: (squared distance, offset into `tris`), visiting as the TS does.
    fn nearest(&self, p: V3, cap_sq: f64) -> (f64, Option<usize>) {
        let [px, py, pz] = p;
        let mut best = cap_sq;
        let mut best_offset = None;
        if self.links.is_empty() {
            return (best, None);
        }
        let mut stack: Vec<i32> = vec![0];
        while let Some(node) = stack.pop() {
            if self.box_distance_sq(node, px, py, pz) >= best {
                continue;
            }
            let left = self.links[node as usize * 4];
            if left < 0 {
                let start = self.links[node as usize * 4 + 2] as usize;
                let n = self.links[node as usize * 4 + 3] as usize;
                for k in 0..n {
                    let o = self.order[start + k] as usize * 9;
                    let d = triangle_distance_sq(&self.tris, o, px, py, pz);
                    if d < best {
                        best = d;
                        best_offset = Some(o);
                    }
                }
                continue;
            }
            let right = self.links[node as usize * 4 + 1];
            if self.box_distance_sq(left, px, py, pz) < self.box_distance_sq(right, px, py, pz) {
                stack.push(right);
                stack.push(left);
            } else {
                stack.push(left);
                stack.push(right);
            }
        }
        (best, best_offset)
    }

    /// Signed distance, the magnitude capped at `cap` (beyond it only the sign is exact).
    pub fn at(&self, p: V3, cap: f64) -> f64 {
        if self.links.is_empty() {
            return cap;
        }
        let (best, _) = self.nearest(p, cap * cap);
        let distance = best.sqrt();
        if self.inside(p[0], p[1], p[2]) { -distance } else { distance }
    }

    /// Closest point on the mesh surface (Sample Nearest Surface).
    pub fn nearest_point(&self, p: V3) -> V3 {
        match self.nearest(p, f64::INFINITY).1 {
            None => p,
            Some(o) => {
                let t = &self.tris;
                closest_on_triangle(p, [t[o], t[o + 1], t[o + 2]], [t[o + 3], t[o + 4], t[o + 5]], [t[o + 6], t[o + 7], t[o + 8]])
            }
        }
    }

    fn inside(&self, x0: f64, y: f64, z0: f64) -> bool {
        // Nudge the ray off grid-aligned vertices and edges, where parity would double count.
        let x = x0 + 1.37e-6;
        let z = z0 + 0.71e-6;
        let t = &self.tris;
        let mut crossings = 0u32;
        let mut stack: Vec<i32> = vec![0];
        while let Some(node) = stack.pop() {
            let b = node as usize * 6;
            if x < self.boxes[b] || x > self.boxes[b + 3] || z < self.boxes[b + 2] || z > self.boxes[b + 5] || self.boxes[b + 4] <= y {
                continue;
            }
            let left = self.links[node as usize * 4];
            if left >= 0 {
                stack.push(left);
                stack.push(self.links[node as usize * 4 + 1]);
                continue;
            }
            let start = self.links[node as usize * 4 + 2] as usize;
            let n = self.links[node as usize * 4 + 3] as usize;
            for k in 0..n {
                let o = self.order[start + k] as usize * 9;
                let (ax, ay, az) = (t[o], t[o + 1], t[o + 2]);
                let (bx, by, bz) = (t[o + 3], t[o + 4], t[o + 5]);
                let (cx, cy, cz) = (t[o + 6], t[o + 7], t[o + 8]);
                let det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
                if det.abs() < 1e-12 {
                    continue;
                }
                let l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
                let l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
                let l3 = 1.0 - l1 - l2;
                if l1 < 0.0 || l2 < 0.0 || l3 <= 0.0 {
                    continue;
                }
                if l1 * ay + l2 * by + l3 * cy > y {
                    crossings += 1;
                }
            }
        }
        crossings % 2 == 1
    }
}

/// Ericson, Real-Time Collision Detection 5.1.5 (closest point on a triangle).
pub fn closest_on_triangle(p: V3, a: V3, b: V3, c: V3) -> V3 {
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ap = sub(p, a);
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = sub(p, b);
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return add(a, scale(ab, d1 / (d1 - d3)));
    }
    let cp = sub(p, c);
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return add(a, scale(ac, d2 / (d2 - d6)));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
        return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
    }
    let denominator = 1.0 / (va + vb + vc);
    add(a, add(scale(ab, vb * denominator), scale(ac, vc * denominator)))
}

/// Squared distance from (px, py, pz) to the triangle at offset `o` of a flat array (Ericson 5.1.5).
fn triangle_distance_sq(t: &[f64], o: usize, px: f64, py: f64, pz: f64) -> f64 {
    let (ax, ay, az) = (t[o], t[o + 1], t[o + 2]);
    let (abx, aby, abz) = (t[o + 3] - ax, t[o + 4] - ay, t[o + 5] - az);
    let (acx, acy, acz) = (t[o + 6] - ax, t[o + 7] - ay, t[o + 8] - az);
    let (apx, apy, apz) = (px - ax, py - ay, pz - az);
    let d1 = abx * apx + aby * apy + abz * apz;
    let d2 = acx * apx + acy * apy + acz * apz;
    if d1 <= 0.0 && d2 <= 0.0 {
        return apx * apx + apy * apy + apz * apz;
    }
    let (bpx, bpy, bpz) = (apx - abx, apy - aby, apz - abz);
    let d3 = abx * bpx + aby * bpy + abz * bpz;
    let d4 = acx * bpx + acy * bpy + acz * bpz;
    if d3 >= 0.0 && d4 <= d3 {
        return bpx * bpx + bpy * bpy + bpz * bpz;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let v = d1 / (d1 - d3);
        let (x, y, z) = (apx - abx * v, apy - aby * v, apz - abz * v);
        return x * x + y * y + z * z;
    }
    let (cpx, cpy, cpz) = (apx - acx, apy - acy, apz - acz);
    let d5 = abx * cpx + aby * cpy + abz * cpz;
    let d6 = acx * cpx + acy * cpy + acz * cpz;
    if d6 >= 0.0 && d5 <= d6 {
        return cpx * cpx + cpy * cpy + cpz * cpz;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let w = d2 / (d2 - d6);
        let (x, y, z) = (apx - acx * w, apy - acy * w, apz - acz * w);
        return x * x + y * y + z * z;
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        let (x, y, z) = (bpx - (acx - abx) * w, bpy - (acy - aby) * w, bpz - (acz - abz) * w);
        return x * x + y * y + z * z;
    }
    let denominator = 1.0 / (va + vb + vc);
    let v = vb * denominator;
    let w = vc * denominator;
    let (x, y, z) = (apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
    x * x + y * y + z * z
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cube() -> SignedDistance {
        let p: [f32; 24] = [0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0., 0., 0., 1., 1., 0., 1., 1., 1., 1., 0., 1., 1.];
        let i: [u32; 36] = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
        SignedDistance::new(&p, &i)
    }

    #[test]
    fn distance_is_negative_inside_and_positive_outside() {
        let sdf = cube();
        assert!((sdf.at([0.5, 0.5, 0.5], f64::INFINITY) + 0.5).abs() < 1e-9);
        assert!((sdf.at([2.0, 0.5, 0.5], f64::INFINITY) - 1.0).abs() < 1e-9);
        assert_eq!(sdf.nearest_point([2.0, 0.5, 0.5])[0], 1.0);
    }
}
