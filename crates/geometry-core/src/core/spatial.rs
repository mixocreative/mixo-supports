//! Triangle BVH (the pick index, D5) with first-hit ray queries. The index is indirect: it holds a
//! permutation of triangle ids and never reorders the mesh's own index array.

const LEAF_SIZE: usize = 8;
/// Slack on bounding boxes so a ray grazing a box edge still reaches its triangles.
const BOX_SLACK: f64 = 1e-6;

/// Which triangle faces a ray may hit, by `(b - a) x (c - a)` against the ray direction (as
/// three.js materials: Front = counter-clockwise toward the ray).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Front,
    Back,
    Double,
}

impl Side {
    pub fn from_flag(flag: u32) -> Option<Self> {
        match flag {
            0 => Some(Self::Front),
            1 => Some(Self::Back),
            2 => Some(Self::Double),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    pub face: u32,
    pub distance: f64,
    pub point: [f64; 3],
}

#[derive(Clone)]
struct Node {
    min: [f32; 3],
    max: [f32; 3],
    /// Leaf: first slot in `order`. Internal: index of the left child (the right is the next node).
    start: u32,
    /// Leaf: triangle count. Internal: 0.
    count: u32,
}

/// A pick index as flat arrays (see `Bvh::to_flat`).
#[derive(Clone, Debug, PartialEq)]
pub struct FlatBvh {
    pub bounds: Vec<f32>,
    pub links: Vec<u32>,
    pub order: Vec<u32>,
}

pub struct Bvh {
    nodes: Vec<Node>,
    order: Vec<u32>,
}

fn vertex(positions: &[f32], index: u32) -> [f64; 3] {
    let o = index as usize * 3;
    [f64::from(positions[o]), f64::from(positions[o + 1]), f64::from(positions[o + 2])]
}

fn triangle(positions: &[f32], indices: &[u32], face: u32) -> [[f64; 3]; 3] {
    let o = face as usize * 3;
    [vertex(positions, indices[o]), vertex(positions, indices[o + 1]), vertex(positions, indices[o + 2])]
}

impl Bvh {
    /// Builds over every triangle of an indexed mesh (callers validated the indices).
    pub fn build(positions: &[f32], indices: &[u32]) -> Self {
        let faces = indices.len() / 3;
        let mut boxes = Vec::with_capacity(faces);
        let mut centroids = Vec::with_capacity(faces);
        for face in 0..faces as u32 {
            let t = triangle(positions, indices, face);
            let mut lo = [f32::INFINITY; 3];
            let mut hi = [f32::NEG_INFINITY; 3];
            let mut c = [0.0f64; 3];
            for p in &t {
                for axis in 0..3 {
                    lo[axis] = lo[axis].min(p[axis] as f32);
                    hi[axis] = hi[axis].max(p[axis] as f32);
                    c[axis] += p[axis] / 3.0;
                }
            }
            boxes.push((lo, hi));
            centroids.push(c);
        }
        let mut bvh = Self { nodes: Vec::new(), order: (0..faces as u32).collect() };
        if faces > 0 {
            bvh.nodes.push(Node { min: [0.0; 3], max: [0.0; 3], start: 0, count: 0 });
            bvh.fill(0, 0, faces, &boxes, &centroids);
        }
        bvh
    }

    fn fill(&mut self, node: usize, start: usize, end: usize, boxes: &[([f32; 3], [f32; 3])], centroids: &[[f64; 3]]) {
        let mut lo = [f32::INFINITY; 3];
        let mut hi = [f32::NEG_INFINITY; 3];
        for &face in &self.order[start..end] {
            let (l, h) = boxes[face as usize];
            for axis in 0..3 {
                lo[axis] = lo[axis].min(l[axis]);
                hi[axis] = hi[axis].max(h[axis]);
            }
        }
        self.nodes[node].min = lo;
        self.nodes[node].max = hi;
        if end - start <= LEAF_SIZE {
            self.nodes[node].start = start as u32;
            self.nodes[node].count = (end - start) as u32;
            return;
        }
        // Split at the median centroid along the widest axis.
        let extent = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        let axis = if extent[0] >= extent[1] && extent[0] >= extent[2] { 0 } else if extent[1] >= extent[2] { 1 } else { 2 };
        let middle = start + (end - start) / 2;
        self.order[start..end].sort_unstable_by(|&a, &b| {
            centroids[a as usize][axis].total_cmp(&centroids[b as usize][axis]).then(a.cmp(&b))
        });
        let left = self.nodes.len();
        self.nodes.push(Node { min: [0.0; 3], max: [0.0; 3], start: 0, count: 0 });
        self.nodes.push(Node { min: [0.0; 3], max: [0.0; 3], start: 0, count: 0 });
        self.nodes[node].start = left as u32;
        self.nodes[node].count = 0;
        self.fill(left, start, middle, boxes, centroids);
        self.fill(left + 1, middle, end, boxes, centroids);
    }

    /// The index as flat arrays for transfer: per node `min xyz, max xyz` (6 f32) and `start, count`
    /// (2 u32), then the triangle permutation.
    pub fn to_flat(&self) -> FlatBvh {
        let mut bounds = Vec::with_capacity(self.nodes.len() * 6);
        let mut links = Vec::with_capacity(self.nodes.len() * 2);
        for node in &self.nodes {
            bounds.extend_from_slice(&node.min);
            bounds.extend_from_slice(&node.max);
            links.extend_from_slice(&[node.start, node.count]);
        }
        FlatBvh { bounds, links, order: self.order.clone() }
    }

    /// Rebuilds an index from `to_flat` arrays for a mesh of `faces` triangles. Everything a query
    /// would index with is checked (never trusted), so a damaged or foreign index is refused, not
    /// walked: the permutation covers every face once, leaves lie inside it, children come after
    /// their parent (no cycles) and inside the node list, boxes are not NaN.
    pub fn from_flat(flat: FlatBvh, faces: usize) -> Option<Self> {
        let FlatBvh { bounds, links, order } = flat;
        let count = links.len() / 2;
        if links.len() % 2 != 0 || bounds.len() != count * 6 || order.len() != faces || (faces > 0) != (count > 0) {
            return None;
        }
        let mut seen = vec![false; faces];
        for &face in &order {
            let slot = seen.get_mut(face as usize)?;
            if std::mem::replace(slot, true) {
                return None;
            }
        }
        if bounds.iter().any(|v| v.is_nan()) {
            return None;
        }
        let mut nodes = Vec::with_capacity(count);
        for (k, pair) in links.chunks_exact(2).enumerate() {
            let (start, leaf_size) = (pair[0] as usize, pair[1] as usize);
            let valid = if leaf_size == 0 { start > k && start + 1 < count } else { start.checked_add(leaf_size)? <= faces };
            if !valid {
                return None;
            }
            let b = &bounds[k * 6..k * 6 + 6];
            nodes.push(Node { min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]], start: pair[0], count: pair[1] });
        }
        Some(Self { nodes, order })
    }

    pub fn triangle_count(&self) -> usize {
        self.order.len()
    }

    /// Distance along the ray to a node's box (None when missed or beyond `far`).
    fn box_entry(&self, node: &Node, origin: &[f64; 3], inverse: &[f64; 3], far: f64) -> Option<f64> {
        let mut t_min = 0.0f64;
        let mut t_max = far;
        for axis in 0..3 {
            let a = (f64::from(node.min[axis]) - BOX_SLACK - origin[axis]) * inverse[axis];
            let b = (f64::from(node.max[axis]) + BOX_SLACK - origin[axis]) * inverse[axis];
            let (near_t, far_t) = if a <= b { (a, b) } else { (b, a) };
            // NaN (0 * inf with the origin on the slab plane) must not reject the box.
            if near_t.is_nan() || far_t.is_nan() {
                continue;
            }
            t_min = t_min.max(near_t);
            t_max = t_max.min(far_t);
            if t_min > t_max {
                return None;
            }
        }
        Some(t_min)
    }

    /// Ids of every triangle whose box (with slack) contains the vertical line through (x, z), in
    /// no particular order. A superset of the triangles a straight-down ray at (x, z) can hit.
    pub fn column_faces(&self, x: f64, z: f64, out: &mut Vec<u32>) {
        if self.nodes.is_empty() || !x.is_finite() || !z.is_finite() {
            return;
        }
        let mut stack = vec![0usize];
        while let Some(index) = stack.pop() {
            let node = &self.nodes[index];
            let inside = |axis: usize, v: f64| v >= f64::from(node.min[axis]) - BOX_SLACK && v <= f64::from(node.max[axis]) + BOX_SLACK;
            if !inside(0, x) || !inside(2, z) {
                continue;
            }
            if node.count == 0 {
                stack.push(node.start as usize);
                stack.push(node.start as usize + 1);
            } else {
                out.extend_from_slice(&self.order[node.start as usize..(node.start + node.count) as usize]);
            }
        }
    }

    /// The nearest hit with `near <= distance <= far`. Equal distances go to the lowest face id.
    pub fn raycast_first(
        &self,
        positions: &[f32],
        indices: &[u32],
        origin: [f64; 3],
        direction: [f64; 3],
        near: f64,
        far: f64,
        side: Side,
    ) -> Option<Hit> {
        if self.nodes.is_empty() {
            return None;
        }
        let inverse = [1.0 / direction[0], 1.0 / direction[1], 1.0 / direction[2]];
        let mut best: Option<(u32, f64)> = None;
        let mut stack = vec![0usize];
        while let Some(index) = stack.pop() {
            let node = &self.nodes[index];
            let limit = best.map_or(far, |(_, t)| t);
            if self.box_entry(node, &origin, &inverse, limit).is_none() {
                continue;
            }
            if node.count == 0 {
                let left = node.start as usize;
                let enter = |i: usize| self.box_entry(&self.nodes[i], &origin, &inverse, limit).unwrap_or(f64::INFINITY);
                // Nearer child on top of the stack.
                if enter(left) <= enter(left + 1) {
                    stack.push(left + 1);
                    stack.push(left);
                } else {
                    stack.push(left);
                    stack.push(left + 1);
                }
                continue;
            }
            for &face in &self.order[node.start as usize..(node.start + node.count) as usize] {
                let [a, b, c] = triangle(positions, indices, face);
                if let Some(t) = intersect_triangle(&origin, &direction, &a, &b, &c, side) {
                    if t >= near && t <= far && best.is_none_or(|(f, d)| t < d || (t == d && face < f)) {
                        best = Some((face, t));
                    }
                }
            }
        }
        best.map(|(face, distance)| Hit {
            face,
            distance,
            point: [
                origin[0] + direction[0] * distance,
                origin[1] + direction[1] * distance,
                origin[2] + direction[2] * distance,
            ],
        })
    }
}

fn sub(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// Moller-Trumbore with three.js's side rule: DdN > 0 means the ray runs along `(b-a) x (c-a)`.
pub fn intersect_triangle(origin: &[f64; 3], direction: &[f64; 3], a: &[f64; 3], b: &[f64; 3], c: &[f64; 3], side: Side) -> Option<f64> {
    let edge1 = sub(b, a);
    let edge2 = sub(c, a);
    let normal = cross(&edge1, &edge2);
    let ddn = dot(direction, &normal);
    let sign = if ddn > 0.0 {
        if side == Side::Front {
            return None;
        }
        1.0
    } else if ddn < 0.0 {
        if side == Side::Back {
            return None;
        }
        -1.0
    } else {
        return None;
    };
    let diff = sub(origin, a);
    let ddqxe2 = sign * dot(direction, &cross(&diff, &edge2));
    if ddqxe2 < 0.0 {
        return None;
    }
    let dde1xq = sign * dot(direction, &cross(&edge1, &diff));
    if dde1xq < 0.0 || ddqxe2 + dde1xq > ddn.abs() {
        return None;
    }
    let qdn = -sign * dot(&diff, &normal);
    if qdn < 0.0 {
        return None;
    }
    Some(qdn / ddn.abs())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A grid of `n` x `n` unit quads in the XY plane at z = 0, counter-clockwise seen from +Z.
    fn grid(n: usize) -> (Vec<f32>, Vec<u32>) {
        let mut p = Vec::new();
        for y in 0..=n {
            for x in 0..=n {
                p.extend_from_slice(&[x as f32, y as f32, 0.0]);
            }
        }
        let mut i = Vec::new();
        for y in 0..n {
            for x in 0..n {
                let a = (y * (n + 1) + x) as u32;
                let (b, c, d) = (a + 1, a + n as u32 + 1, a + n as u32 + 2);
                i.extend_from_slice(&[a, b, d, a, d, c]);
            }
        }
        (p, i)
    }

    #[test]
    fn column_faces_cover_every_face_a_vertical_ray_can_hit() {
        let (p, i) = grid(10);
        let bvh = Bvh::build(&p, &i);
        let mut faces = Vec::new();
        bvh.column_faces(3.7, 0.0, &mut faces);
        // The grid stands in the z = 0 plane: a vertical line at x = 3.7 crosses column 3 of every row.
        assert!((0..10).all(|row| faces.contains(&((row * 10 + 3) * 2))));
        faces.clear();
        bvh.column_faces(3.7, 5.0, &mut faces);
        assert!(faces.is_empty());
        let mut none = Vec::new();
        bvh.column_faces(50.0, 0.0, &mut none);
        assert!(none.is_empty());
    }

    #[test]
    fn flat_round_trip_gives_identical_picks_and_refuses_damaged_indexes() {
        // A ribbon of 200 triangles so the tree has internal nodes.
        let mut positions = Vec::new();
        let mut indices = Vec::new();
        for k in 0..100u32 {
            let x = k as f32;
            positions.extend_from_slice(&[x, 0.0, 0.0, x + 1.0, 0.0, 0.0, x, 1.0, 0.0, x + 1.0, 1.0, 0.0]);
            indices.extend_from_slice(&[k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 1, k * 4 + 3, k * 4 + 2]);
        }
        let built = Bvh::build(&positions, &indices);
        let flat = built.to_flat();
        let loaded = Bvh::from_flat(flat.clone(), indices.len() / 3).expect("a valid index loads");
        assert_eq!(loaded.to_flat(), flat);
        for k in 0..300 {
            let origin = [(k as f64) * 0.37 % 101.0, (k as f64) * 0.13 % 1.2, 5.0];
            for side in [Side::Front, Side::Back, Side::Double] {
                let a = built.raycast_first(&positions, &indices, origin, [0.0, 0.0, -1.0], 0.0, f64::INFINITY, side);
                let b = loaded.raycast_first(&positions, &indices, origin, [0.0, 0.0, -1.0], 0.0, f64::INFINITY, side);
                assert_eq!(a, b);
            }
        }
        let faces = indices.len() / 3;
        assert!(Bvh::from_flat(flat.clone(), faces + 1).is_none(), "wrong triangle count");
        let mut repeated = flat.clone();
        repeated.order[1] = repeated.order[0];
        assert!(Bvh::from_flat(repeated, faces).is_none(), "not a permutation");
        let mut cyclic = flat.clone();
        cyclic.links[0] = 0;
        assert!(Bvh::from_flat(cyclic, faces).is_none(), "child before parent");
        let mut past_end = flat.clone();
        let last = past_end.links.len() - 2;
        past_end.links[last] = faces as u32;
        past_end.links[last + 1] = 5;
        assert!(Bvh::from_flat(past_end, faces).is_none(), "leaf outside the order");
        assert!(Bvh::from_flat(FlatBvh { bounds: vec![], links: vec![], order: vec![] }, 0).is_some());
    }

    #[test]
    fn finds_the_face_under_a_ray_and_respects_sides() {
        let (p, i) = grid(10);
        let bvh = Bvh::build(&p, &i);
        // From +Z looking down: the triangle faces the ray (front).
        let hit = bvh.raycast_first(&p, &i, [3.7, 2.2, 5.0], [0.0, 0.0, -1.0], 0.0, 100.0, Side::Front).unwrap();
        assert!((hit.distance - 5.0).abs() < 1e-12);
        let (x, y) = (3, 2);
        assert_eq!(hit.face / 2, (y * 10 + x) as u32);
        // From below, Front misses, Back and Double hit.
        let below = [3.7, 2.2, -5.0];
        let up = [0.0, 0.0, 1.0];
        assert!(bvh.raycast_first(&p, &i, below, up, 0.0, 100.0, Side::Front).is_none());
        assert!(bvh.raycast_first(&p, &i, below, up, 0.0, 100.0, Side::Back).is_some());
        assert!(bvh.raycast_first(&p, &i, below, up, 0.0, 100.0, Side::Double).is_some());
        assert!(bvh.raycast_first(&p, &i, [3.7, 2.2, 5.0], [0.0, 0.0, -1.0], 0.0, 4.0, Side::Front).is_none());
    }

    #[test]
    fn bvh_matches_brute_force_on_many_rays() {
        let (p, i) = grid(24);
        let bvh = Bvh::build(&p, &i);
        for k in 0..400 {
            let (u, v) = ((k * 37 % 240) as f64 / 10.0 + 0.013, (k * 91 % 240) as f64 / 10.0 + 0.007);
            let dir = [(k % 7) as f64 * 0.05 - 0.1, (k % 5) as f64 * 0.04 - 0.08, -1.0];
            let o = [u, v, 3.0];
            let fast = bvh.raycast_first(&p, &i, o, dir, 0.0, 50.0, Side::Double).map(|h| h.face);
            let slow = (0..(i.len() / 3) as u32)
                .filter_map(|f| {
                    let [a, b, c] = triangle(&p, &i, f);
                    intersect_triangle(&o, &dir, &a, &b, &c, Side::Double).filter(|t| *t <= 50.0).map(|t| (t, f))
                })
                .min_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)))
                .map(|(_, f)| f);
            assert_eq!(fast, slow, "ray {k}");
        }
    }

    #[test]
    fn empty_mesh_has_no_hits() {
        let bvh = Bvh::build(&[], &[]);
        assert!(bvh.raycast_first(&[], &[], [0.0; 3], [0.0, 0.0, 1.0], 0.0, 1.0, Side::Double).is_none());
    }
}
