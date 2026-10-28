//! MergeVoxelRegions: with adaptivity, the cells of each 8^3 leaf merge into 2^3, 4^3 and 8^3
//! regions when the block is manifold and every pair of cell gradients satisfies
//! 1 - dot <= adaptivity; a region has one point, the mean of its cells' points.

use super::grid::{Idx, Remesh, leaf_of};
use crate::core::vec::V3;
use crate::core::jsnum::fr;
use super::tables::{ADAPTABLE, EDGE_GROUPS};
use super::{LEAF, PointId};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;

pub struct Leaf {
    /// Region id per surface cell (cells outside any region are absent).
    pub region: HashMap<Idx, u32>,
    /// Surface cells of each region, by ascending region id.
    pub members: BTreeMap<u32, Vec<Idx>>,
}

fn even(c: Idx) -> Idx {
    [c[0] & !1, c[1] & !1, c[2] & !1]
}

impl Remesh {
    /// Surface cells of the leaf at `origin`, in voxel offset order (x outermost).
    pub(super) fn leaf_cells(&mut self, origin: Idx) -> Vec<Idx> {
        let mut cells = Vec::new();
        for i in 0..LEAF {
            for j in 0..LEAF {
                for k in 0..LEAF {
                    let c = [origin[0] + i, origin[1] + j, origin[2] + k];
                    if self.surface(c) {
                        cells.push(c);
                    }
                }
            }
        }
        cells
    }

    /// MergeVoxelRegions for the leaf whose origin is `origin`.
    pub(super) fn leaf(&mut self, origin: Idx) -> Rc<Leaf> {
        if let Some(l) = self.leaves.get(&origin) {
            return l.clone();
        }
        let mut result = Leaf { region: HashMap::new(), members: BTreeMap::new() };
        if self.adaptivity > 1e-7 && self.leaf_can_have_surface(origin) {
            self.merge_regions(origin, &mut result);
        }
        let rc = Rc::new(result);
        self.leaves.insert(origin, rc.clone());
        rc
    }

    fn merge_regions(&mut self, origin: Idx, result: &mut Leaf) {
        let cells = self.leaf_cells(origin);
        if cells.is_empty() {
            return;
        }
        let mut mask: HashSet<Idx> = HashSet::new();
        for &c in &cells {
            let signs = self.signs(c);
            if ADAPTABLE[signs] == 0 || EDGE_GROUPS[signs][0] > 1 {
                mask.insert(even(c));
            }
        }
        let mut i = 0;
        while i < LEAF {
            let mut j = 0;
            while j < LEAF {
                let mut k = 0;
                while k < LEAF {
                    let b = [origin[0] + i, origin[1] + j, origin[2] + k];
                    if !mask.contains(&b) && self.non_manifold(b, 2) {
                        mask.insert(b);
                    }
                    k += 2;
                }
                j += 2;
            }
            i += 2;
        }
        let mut gradients: HashMap<Idx, V3> = HashMap::new();
        for &c in &cells {
            if !mask.contains(&even(c)) {
                let g = self.gradient(c);
                gradients.insert(c, g);
            }
        }
        let adaptivity = self.adaptivity;
        let mergeable = |b: Idx, dim: i32| {
            let mut norms: Vec<V3> = Vec::new();
            for i in 0..dim {
                for j in 0..dim {
                    for k in 0..dim {
                        if let Some(g) = gradients.get(&[b[0] + i, b[1] + j, b[2] + k]) {
                            norms.push(*g);
                        }
                    }
                }
            }
            for a in &norms {
                for n in &norms {
                    if 1.0 - fr(fr(fr(a[0] * n[0]) + fr(a[1] * n[1])) + fr(a[2] * n[2])) > adaptivity {
                        return false;
                    }
                }
            }
            true
        };
        let mut assignment: HashMap<Idx, u32> = HashMap::new();
        let mut region_id = 1u32;
        let mut dim = 2;
        while dim <= LEAF {
            let coord_mask = !((dim << 1) - 1);
            let mut i = 0;
            while i < LEAF {
                let mut j = 0;
                while j < LEAF {
                    let mut k = 0;
                    while k < LEAF {
                        let b = [origin[0] + i, origin[1] + j, origin[2] + k];
                        if mask.contains(&b) || self.non_manifold(b, dim) || !mergeable(b, dim) {
                            mask.insert([b[0] & coord_mask, b[1] & coord_mask, b[2] & coord_mask]);
                        } else {
                            for a in 0..dim {
                                for c in 0..dim {
                                    for d in 0..dim {
                                        assignment.insert([b[0] + a, b[1] + c, b[2] + d], region_id);
                                    }
                                }
                            }
                            region_id += 1;
                        }
                        k += dim;
                    }
                    j += dim;
                }
                i += dim;
            }
            dim <<= 1;
        }
        for c in cells {
            if let Some(&id) = assignment.get(&c) {
                result.region.insert(c, id);
                result.members.entry(id).or_default().push(c);
            }
        }
    }

    /// The identity of the point a cell contributes to, for the table edge `group` (1 when the cell has one point).
    pub(super) fn point_id(&mut self, c: Idx, group: u8) -> PointId {
        let origin = leaf_of(c);
        let leaf = self.leaf(origin);
        match leaf.region.get(&c) {
            Some(&region) => PointId::Region(origin, region),
            None => PointId::Cell(c, group),
        }
    }
}
