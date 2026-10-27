//! The voxel grid of the remesh: the signed field Blender's Mesh to SDF Grid leaves (a renormalised
//! 3-voxel band), the cell signs with OpenVDB's ambiguous-face correction, and the per-cell
//! quantities (edge-group points, manifold tests, gradients). Work happens in Blender's index space
//! (x, y, z) = web (x, -z, y) so that leaf alignment, sign tables and quad order match OpenVDB.

use super::leaf::Leaf;
use super::num::{V3, add, fr, hypot, scale};
use super::sdf::SignedDistance;
use super::tables::{ADAPTABLE, AMBIGUOUS_FACE, EDGE_GROUPS};
use super::{LEAF, Polygon, PointId, Prim};
use std::collections::HashMap;
use std::rc::Rc;

pub type Idx = [i32; 3];

/// Blender's Mesh to SDF Grid + Grid to Mesh, reproduced from OpenVDB's VolumeToMesh around the
/// points that are queried (see the TS oracle `remesh.ts` for the derivation). Queries fill the
/// caches lazily; hold one per model, frame and voxel size.
pub struct Remesh {
    /// Voxel size (single precision).
    pub voxel: f64,
    /// Lowest web height the remesh can reach.
    pub bottom: f64,
    pub(super) bounds: (V3, V3),
    pub(super) adaptivity: f64,
    pub(super) sdf: SignedDistance,
    values: HashMap<Idx, f64>,
    exact_values: HashMap<Idx, f64>,
    sign_cache: HashMap<Idx, u8>,
    pub(super) leaves: HashMap<Idx, Rc<Leaf>>,
    pub(super) prims: Vec<Prim>,
    pub(super) prim_cache: HashMap<(Idx, u8), Option<usize>>,
    pub(super) raw: HashMap<PointId, V3>,
    pub(super) final_points: HashMap<PointId, V3>,
    pub(super) polygon_cache: HashMap<usize, Option<Rc<Polygon>>>,
    empty_leaves: HashMap<Idx, bool>,
    pub(super) leaf_polygon_cache: HashMap<Idx, Rc<Vec<Rc<Polygon>>>>,
}

impl Remesh {
    /// `voxel` overrides SLASG_Line's size (the scatter remeshes at Spacing / 4); `adaptivity` is
    /// Grid to Mesh's (0.1 in SLASG).
    pub fn new(positions: &[f32], indices: &[u32], pillar_diameter: f64, voxel: Option<f64>, adaptivity: f64) -> Self {
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        for p in positions.chunks_exact(3) {
            for axis in 0..3 {
                min[axis] = min[axis].min(f64::from(p[axis]));
                max[axis] = max[axis].max(f64::from(p[axis]));
            }
        }
        let diagonal = hypot(&[max[0] - min[0], max[1] - min[1], max[2] - min[2]]);
        // Geometry Nodes evaluates the voxel size in single precision.
        let h = fr(voxel.unwrap_or_else(|| (diagonal / 2000.0).max(pillar_diameter)));
        // meshToVolume measures distance in index space from single-precision index points.
        let index_positions: Vec<f32> = positions.iter().map(|&v| (f64::from(v) / h) as f32).collect();
        Self {
            voxel: h,
            bottom: min[1] - 2.0 * h,
            bounds: (min, max),
            adaptivity: fr(adaptivity),
            sdf: SignedDistance::new(&index_positions, indices),
            values: HashMap::new(),
            exact_values: HashMap::new(),
            sign_cache: HashMap::new(),
            leaves: HashMap::new(),
            prims: Vec::new(),
            prim_cache: HashMap::new(),
            raw: HashMap::new(),
            final_points: HashMap::new(),
            polygon_cache: HashMap::new(),
            empty_leaves: HashMap::new(),
            leaf_polygon_cache: HashMap::new(),
        }
    }

    /// Exact signed distance at node `c` (single precision), as meshToVolume voxelizes it.
    fn exact(&mut self, c: Idx) -> f64 {
        if let Some(&v) = self.exact_values.get(&c) {
            return v;
        }
        // Beyond the 3-voxel band only the sign matters.
        let d = self.sdf.at([f64::from(c[0]), f64::from(c[2]), -f64::from(c[1])], 4.0);
        let value = fr(fr(d) * self.voxel);
        self.exact_values.insert(c, value);
        value
    }

    /// Grid value at node `c`. meshToVolume keeps a band of 3 voxels each side (beyond it the
    /// background, +-3 voxels) and renormalizes it: values move in by 0.8 voxel, take the min with
    /// one Godunov reinitialization step, and move back by 0.8 voxel - 1e-7.
    pub(super) fn value(&mut self, c: Idx) -> f64 {
        if let Some(&v) = self.values.get(&c) {
            return v;
        }
        let h = self.voxel;
        let band = fr(3.0 * h);
        let offset = fr(0.8 * h);
        let back = fr(offset - fr(1e-7));
        let shifted = |me: &mut Self, n: Idx| {
            let d = me.exact(n);
            if d.abs() < band { fr(d - offset) } else if d < 0.0 { -band } else { band }
        };
        let d = self.exact(c);
        let value = if d.abs() >= band {
            if d < 0.0 { -band } else { band }
        } else {
            let phi = shifted(self, c);
            let [i, j, k] = c;
            let mut up = [0.0; 3];
            let mut down = [0.0; 3];
            let dirs: [Idx; 3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
            for axis in 0..3 {
                let d = dirs[axis];
                up[axis] = fr(shifted(self, [i + d[0], j + d[1], k + d[2]]) - phi);
                down[axis] = fr(phi - shifted(self, [i - d[0], j - d[1], k - d[2]]));
            }
            let mut norm_sq = 0.0;
            for axis in 0..3 {
                norm_sq += if phi > 0.0 {
                    (down[axis].max(0.0).powi(2)).max(up[axis].min(0.0).powi(2))
                } else {
                    (down[axis].min(0.0).powi(2)).max(up[axis].max(0.0).powi(2))
                };
            }
            let norm_sq = fr(norm_sq);
            let diff = fr(fr(norm_sq.sqrt()) / h - 1.0);
            let sign = fr(phi / fr((phi * phi + norm_sq).sqrt()));
            let renormalized = fr(phi - fr(h * sign * diff));
            fr(phi.min(renormalized) + back)
        };
        self.values.insert(c, value);
        value
    }

    /// OpenVDB isInsideValue: strictly below the iso value 0.
    pub(super) fn inside(&mut self, c: Idx) -> bool {
        self.value(c) < 0.0
    }

    /// The eight corner values in OpenVDB order.
    fn corner_values(&mut self, [i, j, k]: Idx) -> [f64; 8] {
        let cs: [Idx; 8] = [[i, j, k], [i + 1, j, k], [i + 1, j, k + 1], [i, j, k + 1], [i, j + 1, k], [i + 1, j + 1, k], [i + 1, j + 1, k + 1], [i, j + 1, k + 1]];
        let mut out = [0.0; 8];
        for (n, c) in cs.iter().enumerate() {
            out[n] = self.value(*c);
        }
        out
    }

    fn raw_signs(&mut self, c: Idx) -> usize {
        let mut signs = 0;
        for (n, v) in self.corner_values(c).iter().enumerate() {
            if *v < 0.0 {
                signs |= 1 << n;
            }
        }
        signs
    }

    /// Cell signs after OpenVDB's ambiguous-face correction.
    pub(super) fn signs(&mut self, c: Idx) -> usize {
        if let Some(&s) = self.sign_cache.get(&c) {
            return usize::from(s);
        }
        let mut signs = self.raw_signs(c);
        let face = AMBIGUOUS_FACE[signs];
        if signs != 0 && signs != 0xff && face != 0 {
            let [i, j, k] = c;
            let (neighbour, expected) = match face {
                1 => ([i, j, k - 1], 3),
                2 => ([i + 1, j, k], 4),
                3 => ([i, j, k + 1], 1),
                4 => ([i - 1, j, k], 2),
                5 => ([i, j - 1, k], 6),
                _ => ([i, j + 1, k], 5),
            };
            let raw = self.raw_signs(neighbour);
            if AMBIGUOUS_FACE[raw] == expected {
                signs = !signs & 0xff;
            }
        }
        self.sign_cache.insert(c, signs as u8);
        signs
    }

    pub(super) fn surface(&mut self, c: Idx) -> bool {
        let signs = self.signs(c);
        signs != 0 && signs != 0xff
    }

    /// Number of cell points (edge groups) of a cell.
    pub(super) fn group_count(&mut self, c: Idx) -> u8 {
        let signs = self.signs(c);
        EDGE_GROUPS[signs][0]
    }

    /// Edge group of each of the 12 edges (1-based edge numbers, index 0 is the group count).
    pub(super) fn edge_groups(&mut self, c: Idx) -> [u8; 13] {
        let signs = self.signs(c);
        EDGE_GROUPS[signs]
    }

    /// Mean of the crossings of one edge group, in cell-local index units.
    pub(super) fn group_point(&mut self, c: Idx, group: u8) -> V3 {
        let v = self.corner_values(c);
        let groups = self.edge_groups(c);
        let t = |a: usize, b: usize| v[a] / (v[a] - v[b]);
        let edges: [(usize, V3); 12] = [
            (1, [t(0, 1), 0.0, 0.0]), (2, [1.0, 0.0, t(1, 2)]), (3, [t(3, 2), 0.0, 1.0]), (4, [0.0, 0.0, t(0, 3)]),
            (5, [t(4, 5), 1.0, 0.0]), (6, [1.0, 1.0, t(5, 6)]), (7, [t(7, 6), 1.0, 1.0]), (8, [0.0, 1.0, t(4, 7)]),
            (9, [0.0, t(0, 4), 0.0]), (10, [1.0, t(1, 5), 0.0]), (11, [1.0, t(2, 6), 1.0]), (12, [0.0, t(3, 7), 1.0]),
        ];
        let mut sum = [0.0; 3];
        let mut samples = 0;
        for (edge, at) in edges {
            if groups[edge] != group {
                continue;
            }
            sum = add(sum, at);
            samples += 1;
        }
        if samples > 1 { scale(sum, 1.0 / f64::from(samples)) } else { sum }
    }

    /// Whether merging the `dim`-cell block at `[i, j, k]` would not be manifold.
    pub(super) fn non_manifold(&mut self, [i, j, k]: Idx, dim: i32) -> bool {
        let h = dim >> 1;
        let corners: [Idx; 8] = [[i, j, k], [i + dim, j, k], [i + dim, j, k + dim], [i, j, k + dim], [i, j + dim, k], [i + dim, j + dim, k], [i + dim, j + dim, k + dim], [i, j + dim, k + dim]];
        let mut p = [false; 8];
        let mut signs = 0;
        for (n, c) in corners.iter().enumerate() {
            p[n] = self.inside(*c);
            if p[n] {
                signs |= 1 << n;
            }
        }
        if ADAPTABLE[signs] == 0 {
            return true;
        }
        let (ip, ipp, jp, jpp, kp, kpp) = (i + h, i + dim, j + h, j + dim, k + h, k + dim);
        let edges: [(Idx, usize, usize); 12] = [
            ([ip, j, k], 0, 1), ([ipp, j, kp], 1, 2), ([ip, j, kpp], 2, 3), ([i, j, kp], 0, 3),
            ([ip, jpp, k], 4, 5), ([ipp, jpp, kp], 5, 6), ([ip, jpp, kpp], 6, 7), ([i, jpp, kp], 7, 4),
            ([i, jp, k], 0, 4), ([ipp, jp, k], 1, 5), ([ipp, jp, kpp], 2, 6), ([i, jp, kpp], 3, 7),
        ];
        for (c, a, b) in edges {
            let v = self.inside(c);
            if p[a] != v && p[b] != v {
                return true;
            }
        }
        let faces: [(Idx, [usize; 4]); 6] = [
            ([ip, jp, k], [0, 1, 4, 5]), ([ipp, jp, kp], [1, 2, 5, 6]), ([ip, jp, kpp], [2, 3, 6, 7]),
            ([i, jp, kp], [0, 3, 4, 7]), ([ip, j, kp], [0, 1, 2, 3]), ([ip, jpp, kp], [4, 5, 6, 7]),
        ];
        for (c, corners) in faces {
            let v = self.inside(c);
            if corners.iter().all(|&n| p[n] != v) {
                return true;
            }
        }
        let centre = self.inside([ip, jp, kp]);
        p.iter().all(|&v| v != centre)
    }

    /// Normalised central-difference gradient at node `c`, in single precision.
    pub(super) fn gradient(&mut self, [i, j, k]: Idx) -> V3 {
        let g = [
            fr((self.value([i + 1, j, k]) - self.value([i - 1, j, k])) * 0.5),
            fr((self.value([i, j + 1, k]) - self.value([i, j - 1, k])) * 0.5),
            fr((self.value([i, j, k + 1]) - self.value([i, j, k - 1])) * 0.5),
        ];
        let length = hypot(&g);
        if length == 0.0 { g } else { [fr(g[0] / length), fr(g[1] / length), fr(g[2] / length)] }
    }

    /// The leaf might hold surface cells (the field changes sign within reach of it).
    pub(super) fn leaf_can_have_surface(&mut self, origin: Idx) -> bool {
        if let Some(&r) = self.empty_leaves.get(&origin) {
            return r;
        }
        let half = LEAF / 2;
        let centre = [origin[0] + half, origin[1] + half, origin[2] + half];
        let d = self.sdf.at([f64::from(centre[0]), f64::from(centre[2]), -f64::from(centre[1])], 12.0);
        let result = d.abs() <= f64::from(half + 2) * 3f64.sqrt();
        self.empty_leaves.insert(origin, result);
        result
    }
}

pub(super) fn leaf_of(c: Idx) -> Idx {
    [c[0].div_euclid(LEAF) * LEAF, c[1].div_euclid(LEAF) * LEAF, c[2].div_euclid(LEAF) * LEAF]
}
