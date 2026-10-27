//! Nearest-point queries over a fixed point set in single precision, as Blender's Geometry
//! Proximity (target Points) measures: each point is a box padded by 2^-23 per axis and the
//! distance is to the closest point of that box. Exact; equal distances go to the lowest index.

const PAD: f32 = 1.0 / 8_388_608.0;
const LEAF_SIZE: usize = 8;

struct Node {
    lo: [f32; 3],
    hi: [f32; 3],
    /// First child (the second is `child + 1`); `None` for a leaf.
    child: Option<usize>,
    start: usize,
    end: usize,
}

pub struct NearestPoint {
    /// Per point: low xyz, high xyz.
    boxes: Vec<[f32; 6]>,
    order: Vec<usize>,
    nodes: Vec<Node>,
}

fn box_distance(b: &[f32; 6], q: &[f32; 3]) -> f32 {
    let d = |axis: usize| q[axis] - q[axis].max(b[axis]).min(b[axis + 3]);
    let (dx, dy, dz) = (d(0), d(1), d(2));
    dx * dx + dy * dy + dz * dz
}

impl NearestPoint {
    /// `points` holds xyz triples.
    pub fn new(points: &[f32]) -> Self {
        let boxes: Vec<[f32; 6]> = points
            .chunks_exact(3)
            .map(|p| [p[0] - PAD, p[1] - PAD, p[2] - PAD, p[0] + PAD, p[1] + PAD, p[2] + PAD])
            .collect();
        let count = boxes.len();
        let mut tree = Self { boxes, order: (0..count).collect(), nodes: Vec::new() };
        if count > 0 {
            tree.nodes.push(Node { lo: [0.0; 3], hi: [0.0; 3], child: None, start: 0, end: 0 });
            tree.build(0, 0, count);
        }
        tree
    }

    fn build(&mut self, node: usize, start: usize, end: usize) {
        let mut lo = [f32::INFINITY; 3];
        let mut hi = [f32::NEG_INFINITY; 3];
        for &i in &self.order[start..end] {
            for axis in 0..3 {
                lo[axis] = lo[axis].min(self.boxes[i][axis]);
                hi[axis] = hi[axis].max(self.boxes[i][axis + 3]);
            }
        }
        self.nodes[node] = Node { lo, hi, child: None, start, end };
        if end - start <= LEAF_SIZE {
            return;
        }
        let extent = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        let axis = if extent[0] >= extent[1] && extent[0] >= extent[2] { 0 } else if extent[1] >= extent[2] { 1 } else { 2 };
        let boxes = &self.boxes;
        self.order[start..end].sort_by(|&a, &b| boxes[a][axis].total_cmp(&boxes[b][axis]).then(a.cmp(&b)));
        let middle = start + ((end - start) >> 1);
        let first = self.nodes.len();
        for _ in 0..2 {
            self.nodes.push(Node { lo: [0.0; 3], hi: [0.0; 3], child: None, start: 0, end: 0 });
        }
        self.nodes[node].child = Some(first);
        self.build(first, start, middle);
        self.build(first + 1, middle, end);
    }

    fn node_distance(&self, node: usize, q: &[f32; 3]) -> f32 {
        let n = &self.nodes[node];
        box_distance(&[n.lo[0], n.lo[1], n.lo[2], n.hi[0], n.hi[1], n.hi[2]], q)
    }

    /// Index of the nearest point and the closest position on its box; `None` for an empty set.
    pub fn nearest_hit(&self, co: [f32; 3]) -> Option<(usize, [f32; 3])> {
        let mut best_index = usize::MAX;
        let mut best = f32::INFINITY;
        let mut stack = if self.nodes.is_empty() { Vec::new() } else { vec![0usize] };
        while let Some(node) = stack.pop() {
            if self.node_distance(node, &co) > best {
                continue;
            }
            match self.nodes[node].child {
                None => {
                    for n in self.nodes[node].start..self.nodes[node].end {
                        let index = self.order[n];
                        let d = box_distance(&self.boxes[index], &co);
                        if d < best || (d == best && index < best_index) {
                            best = d;
                            best_index = index;
                        }
                    }
                }
                Some(child) => {
                    let near = if self.node_distance(child, &co) <= self.node_distance(child + 1, &co) { child } else { child + 1 };
                    stack.push(if near == child { child + 1 } else { child });
                    stack.push(near);
                }
            }
        }
        if best_index == usize::MAX {
            return None;
        }
        let b = &self.boxes[best_index];
        Some((best_index, std::array::from_fn(|axis| co[axis].max(b[axis]).min(b[axis + 3]))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_brute_force_with_lowest_index_on_ties() {
        let points: Vec<f32> = (0..300).flat_map(|i| [((i * 17) % 23) as f32, ((i * 5) % 11) as f32, (i % 3) as f32]).collect();
        let tree = NearestPoint::new(&points);
        for k in 0..200 {
            let q = [(k % 23) as f32 + 0.25, (k % 11) as f32 + 0.5, (k % 3) as f32 - 0.1];
            let brute = points
                .chunks_exact(3)
                .enumerate()
                .map(|(i, p)| (i, (p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2)))
                .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
                .unwrap()
                .0;
            assert_eq!(tree.nearest_hit(q).unwrap().0, brute, "query {k}");
        }
        assert!(NearestPoint::new(&[]).nearest_hit([0.0; 3]).is_none());
    }
}
