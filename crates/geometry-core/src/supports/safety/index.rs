//! One X/Z broadphase over the model for every exact support/model test of a generate call (port of
//! TS `modelCollisionIndex.ts`). Built once per call and shared by both policies.

use super::tri::Tri;
use crate::core::vec::V3;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min: V3,
    pub max: V3,
}

impl Bounds {
    pub fn of(tri: &Tri) -> Self {
        let mut min = tri[0];
        let mut max = tri[0];
        for p in &tri[1..] {
            for axis in 0..3 {
                min[axis] = min[axis].min(p[axis]);
                max[axis] = max[axis].max(p[axis]);
            }
        }
        Self { min, max }
    }

    pub fn overlaps(&self, other: &Bounds) -> bool {
        !(self.max[1] < other.min[1] || self.min[1] > other.max[1] || self.max[0] < other.min[0] || self.min[0] > other.max[0] || self.max[2] < other.min[2] || self.min[2] > other.max[2])
    }
}

pub fn triangle_of(positions: &[f32], indices: &[u32], face: usize) -> Tri {
    let vertex = |corner: usize| {
        let o = indices[face * 3 + corner] as usize * 3;
        [f64::from(positions[o]), f64::from(positions[o + 1]), f64::from(positions[o + 2])]
    };
    [vertex(0), vertex(1), vertex(2)]
}

pub struct CollisionIndex<'a> {
    pub positions: &'a [f32],
    pub indices: &'a [u32],
    /// False when the model is empty or malformed: no verdict may be `Clear` then.
    pub valid: bool,
    pub cell_mm: f64,
    cells: HashMap<(i64, i64), Vec<u32>>,
    pub face_bounds: Vec<Bounds>,
}

impl<'a> CollisionIndex<'a> {
    pub fn new(positions: &'a [f32], indices: &'a [u32]) -> Self {
        let mut valid = !indices.is_empty() && indices.len() % 3 == 0 && positions.len() % 3 == 0;
        let (mut min_x, mut max_x, mut min_z, mut max_z) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
        for p in positions.chunks_exact(3) {
            min_x = min_x.min(f64::from(p[0]));
            max_x = max_x.max(f64::from(p[0]));
            min_z = min_z.min(f64::from(p[2]));
            max_z = max_z.max(f64::from(p[2]));
        }
        let extent = if min_x.is_finite() { (max_x - min_x).max(max_z - min_z) } else { 0.0 };
        let cell_mm = 0.5f64.max(extent / 64.0);
        let mut index = Self { positions, indices, valid, cell_mm, cells: HashMap::new(), face_bounds: Vec::new() };
        if !valid || positions.iter().any(|v| !v.is_finite()) || indices.iter().any(|&i| i as usize * 3 + 2 >= positions.len()) {
            index.valid = false;
            return index;
        }
        for face in 0..indices.len() / 3 {
            let tri = triangle_of(positions, indices, face);
            let b = Bounds::of(&tri);
            if b.min.iter().chain(&b.max).any(|v| !v.is_finite()) {
                valid = false;
                break;
            }
            index.face_bounds.push(b);
            for x in (b.min[0] / cell_mm).floor() as i64..=(b.max[0] / cell_mm).floor() as i64 {
                for z in (b.min[2] / cell_mm).floor() as i64..=(b.max[2] / cell_mm).floor() as i64 {
                    index.cells.entry((x, z)).or_default().push(face as u32);
                }
            }
        }
        index.valid = valid;
        index
    }

    pub fn cell(&self, x: i64, z: i64) -> &[u32] {
        self.cells.get(&(x, z)).map_or(&[], Vec::as_slice)
    }

    pub fn face_count(&self) -> usize {
        self.indices.len() / 3
    }

    pub fn triangle(&self, face: usize) -> Tri {
        triangle_of(self.positions, self.indices, face)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_faces_by_cell_and_flags_bad_models() {
        let positions = [0.0f32, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 10.0];
        let index = CollisionIndex::new(&positions, &[0, 1, 2]);
        assert!(index.valid && index.face_count() == 1 && index.cell_mm == 0.5);
        assert_eq!(index.cell(0, 0), &[0]);
        assert!(!CollisionIndex::new(&positions, &[]).valid);
        assert!(!CollisionIndex::new(&positions, &[0, 1, 9]).valid);
        let nan = [f32::NAN, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
        assert!(!CollisionIndex::new(&nan, &[0, 1, 2]).valid);
    }
}
