//! The model as the support builder sees it: plate-space triangles with the core BVH. Port of the
//! exact (non-remeshed) path of TS `DownRaycaster` (landing rays) and `closestOnMesh`. The voxel
//! remesh refinement the TS `LineTarget` adds on top is U5; until then a caller may supply landings.

use super::landing::Landing;
use super::vec::{V3, add, cross, dot, length, normalize_or_down, scale, sub};
use crate::core::spatial::Bvh;

pub struct Model<'a> {
    positions: &'a [f32],
    indices: &'a [u32],
    bvh: &'a Bvh,
    /// Extent of the model along Y: the farthest a landing ray looks.
    pub height: f64,
}

impl<'a> Model<'a> {
    pub fn new(positions: &'a [f32], indices: &'a [u32], bvh: &'a Bvh) -> Self {
        let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
        for y in positions.iter().skip(1).step_by(3) {
            low = low.min(f64::from(*y));
            high = high.max(f64::from(*y));
        }
        Self { positions, indices, bvh, height: if low.is_finite() { high - low } else { 0.0 } }
    }

    pub fn positions(&self) -> &'a [f32] {
        self.positions
    }

    pub fn indices(&self) -> &'a [u32] {
        self.indices
    }

    /// Highest vertex (plate Y), 0 for an empty model.
    pub fn top(&self) -> f64 {
        let top = self.positions.iter().skip(1).step_by(3).fold(f64::NEG_INFINITY, |m, y| m.max(f64::from(*y)));
        if top.is_finite() { top } else { 0.0 }
    }

    pub fn face_count(&self) -> usize {
        self.indices.len() / 3
    }

    pub fn triangle(&self, face: u32) -> [V3; 3] {
        let at = |k: usize| {
            let o = self.indices[face as usize * 3 + k] as usize * 3;
            [f64::from(self.positions[o]), f64::from(self.positions[o + 1]), f64::from(self.positions[o + 2])]
        };
        [at(0), at(1), at(2)]
    }

    /// Ascending ids of the triangles a vertical line at (x, z) can touch.
    pub fn column_faces(&self, x: f64, z: f64) -> Vec<u32> {
        let mut faces = Vec::new();
        self.bvh.column_faces(x, z, &mut faces);
        faces.sort_unstable();
        faces
    }

    /// Nearest surface straight below `from` within `length`, with its upward face normal. Equal
    /// heights go to the lowest face id.
    pub fn cast_down(&self, from: V3, length: f64) -> Option<Landing> {
        let mut best: Option<(f64, u32)> = None;
        for face in self.column_faces(from[0], from[2]) {
            let [a, b, c] = self.triangle(face);
            let det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
            if det.abs() < 1e-12 {
                continue;
            }
            let l1 = ((b[2] - c[2]) * (from[0] - c[0]) + (c[0] - b[0]) * (from[2] - c[2])) / det;
            let l2 = ((c[2] - a[2]) * (from[0] - c[0]) + (a[0] - c[0]) * (from[2] - c[2])) / det;
            let l3 = 1.0 - l1 - l2;
            if l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9 {
                continue;
            }
            let y = l1 * a[1] + l2 * b[1] + l3 * c[1];
            if y >= from[1] - 1e-6 || from[1] - y > length {
                continue;
            }
            if best.is_none_or(|(top, _)| y > top) {
                best = Some((y, face));
            }
        }
        best.map(|(y, face)| {
            let [a, b, c] = self.triangle(face);
            let mut normal = normalize_or_down(cross(sub(b, a), sub(c, a)));
            if normal[1] < 0.0 {
                normal = [-normal[0], -normal[1], -normal[2]];
            }
            Landing { point: [from[0], y, from[2]], normal, face: Some(face), source_point: None }
        })
    }

    /// True when a face below `from` within `length` is steeper than `limit` radians from facing
    /// straight down (a non-overhang face of the Auto Tree scatter) and the vertical line meets it.
    pub fn hits_blocker_below(&self, from: V3, length: f64, limit: f64) -> bool {
        self.column_faces(from[0], from[2]).into_iter().any(|face| {
            let [a, b, c] = self.triangle(face);
            let size = length_of(cross(sub(b, a), sub(c, a)));
            let normal = if size == 0.0 { [0.0; 3] } else { scale(cross(sub(b, a), sub(c, a)), 1.0 / size) };
            if (-normal[1]).clamp(-1.0, 1.0).acos() <= limit {
                return false;
            }
            let det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
            if det.abs() < 1e-12 {
                return false;
            }
            let l1 = ((b[2] - c[2]) * (from[0] - c[0]) + (c[0] - b[0]) * (from[2] - c[2])) / det;
            let l2 = ((c[2] - a[2]) * (from[0] - c[0]) + (a[0] - c[0]) * (from[2] - c[2])) / det;
            let l3 = 1.0 - l1 - l2;
            if l1 < 0.0 || l2 < 0.0 || l3 < 0.0 {
                return false;
            }
            let y = l1 * a[1] + l2 * b[1] + l3 * c[1];
            y < from[1] && from[1] - y <= length
        })
    }

    /// Closest point on the model surface (Sample Nearest Surface); the first face wins a tie.
    pub fn closest_point(&self, point: V3) -> V3 {
        let mut best = point;
        let mut best_distance = f64::INFINITY;
        for face in 0..self.face_count() as u32 {
            let [a, b, c] = self.triangle(face);
            let candidate = closest_on_triangle(point, a, b, c);
            let d = hypot3(sub(candidate, point));
            if d < best_distance {
                best_distance = d;
                best = candidate;
            }
        }
        best
    }
}

fn length_of(v: V3) -> f64 {
    length(v)
}

/// `Math.hypot(x, y, z)` as V8 computes it (scaled, Kahan-summed), so distance comparisons that break
/// ties between faces agree with the TS oracle to the last bit.
pub fn hypot3(v: V3) -> f64 {
    crate::supports::remesh::hypot3(v)
}

/// Ericson, Real-Time Collision Detection 5.1.5.
pub(crate) fn closest_on_triangle(p: V3, a: V3, b: V3, c: V3) -> V3 {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A flat square at y = 2 (two triangles facing up).
    fn slab() -> (Vec<f32>, Vec<u32>) {
        (vec![0.0, 2.0, 0.0, 4.0, 2.0, 0.0, 4.0, 2.0, 4.0, 0.0, 2.0, 4.0], vec![0, 2, 1, 0, 3, 2])
    }

    #[test]
    fn casts_down_to_the_surface_with_an_upward_normal() {
        let (p, i) = slab();
        let bvh = Bvh::build(&p, &i);
        let model = Model::new(&p, &i, &bvh);
        let hit = model.cast_down([1.0, 5.0, 1.0], 10.0).unwrap();
        assert_eq!(hit.point, [1.0, 2.0, 1.0]);
        assert_eq!(hit.normal, [0.0, 1.0, 0.0]);
        assert!(model.cast_down([1.0, 5.0, 1.0], 2.0).is_none());
        assert!(model.cast_down([9.0, 5.0, 1.0], 10.0).is_none());
        assert!(model.cast_down([1.0, 1.0, 1.0], 10.0).is_none());
    }

    #[test]
    fn a_ray_on_the_shared_edge_takes_the_lowest_face() {
        let (p, i) = slab();
        let bvh = Bvh::build(&p, &i);
        let model = Model::new(&p, &i, &bvh);
        assert_eq!(model.cast_down([2.0, 3.0, 2.0], 5.0).unwrap().face, Some(0));
    }

    #[test]
    fn closest_point_projects_onto_the_surface() {
        let (p, i) = slab();
        let bvh = Bvh::build(&p, &i);
        let model = Model::new(&p, &i, &bvh);
        assert_eq!(model.closest_point([1.0, 7.0, 1.0]), [1.0, 2.0, 1.0]);
    }
}
