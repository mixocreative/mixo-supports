//! Triangle mesh view and the double-precision vector helpers the dental detectors share.
//! The float operation order mirrors the TypeScript oracle (`scripts/test-support/ts-oracle/dental`).

pub type V3 = [f64; 3];

/// Borrowed welded triangle mesh: f32 positions, u32 indices.
#[derive(Clone, Copy)]
pub struct Mesh<'a> {
    pub positions: &'a [f32],
    pub indices: &'a [u32],
}

impl<'a> Mesh<'a> {
    pub fn new(positions: &'a [f32], indices: &'a [u32]) -> Self {
        Self { positions, indices }
    }
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }
    pub fn face_count(&self) -> usize {
        self.indices.len() / 3
    }
    pub fn point(&self, index: u32) -> V3 {
        let at = index as usize * 3;
        [f64::from(self.positions[at]), f64::from(self.positions[at + 1]), f64::from(self.positions[at + 2])]
    }
    pub fn corner(&self, face: usize, corner: usize) -> u32 {
        self.indices[face * 3 + corner]
    }
    pub fn face_points(&self, face: usize) -> [V3; 3] {
        [self.point(self.corner(face, 0)), self.point(self.corner(face, 1)), self.point(self.corner(face, 2))]
    }
    /// The shape the TS `proposeDentalOrientation` accepts: finite, at least four vertices
    /// and four faces' worth of indices, every index in range.
    pub fn is_valid(&self) -> bool {
        self.positions.len() >= 12
            && self.positions.len() % 3 == 0
            && self.indices.len() >= 12
            && self.indices.len() % 3 == 0
            && self.positions.iter().all(|value| value.is_finite())
            && self.indices.iter().all(|&index| (index as usize) < self.vertex_count())
    }
}

pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
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

/// `Math.hypot` of three values the way V8 computes it (scaled, Kahan-compensated sum).
pub fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    let values = [x.abs(), y.abs(), z.abs()];
    let max = values.iter().cloned().fold(0.0, f64::max);
    if max == 0.0 {
        return 0.0;
    }
    if !max.is_finite() {
        return f64::INFINITY;
    }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for value in values {
        let n = value / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

pub fn length(v: V3) -> f64 {
    hypot3(v[0], v[1], v[2])
}
pub fn distance(a: V3, b: V3) -> f64 {
    hypot3(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
/// Unit vector; a zero-length input stays `[0, 0, 0]`.
pub fn normalize(v: V3) -> V3 {
    let size = length(v);
    if size == 0.0 { [0.0; 3] } else { [v[0] / size, v[1] / size, v[2] / size] }
}
/// Sum of points starting from zero, in order (`reduce` in the oracle).
pub fn sum_points(points: impl Iterator<Item = V3>) -> V3 {
    points.fold([0.0; 3], add)
}

/// Binary min-heap on an `f64` cost with the oracle's exact sift rules, so equal-cost ties
/// resolve to the same neighbour order as the TypeScript implementation.
pub struct MinHeap<T> {
    items: Vec<(f64, T)>,
}

impl<T: Copy> MinHeap<T> {
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
    pub fn push(&mut self, cost: f64, value: T) {
        self.items.push((cost, value));
        let mut at = self.items.len() - 1;
        while at > 0 {
            let parent = (at - 1) >> 1;
            if self.items[parent].0 <= self.items[at].0 {
                break;
            }
            self.items.swap(parent, at);
            at = parent;
        }
    }
    pub fn pop(&mut self) -> Option<(f64, T)> {
        if self.items.is_empty() {
            return None;
        }
        let first = self.items[0];
        let last = self.items.pop().expect("non-empty");
        if !self.items.is_empty() {
            self.items[0] = last;
            let mut at = 0;
            loop {
                let left = at * 2 + 1;
                let right = left + 1;
                if left >= self.items.len() {
                    break;
                }
                let child = if right < self.items.len() && self.items[right].0 < self.items[left].0 { right } else { left };
                if self.items[at].0 <= self.items[child].0 {
                    break;
                }
                self.items.swap(at, child);
                at = child;
            }
        }
        Some(first)
    }
}

impl<T: Copy> Default for MinHeap<T> {
    fn default() -> Self {
        Self::new()
    }
}
