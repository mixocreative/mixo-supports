//! The whole remesh as Grid to Mesh outputs it (what the scatter distributes points on).

use super::grid::{Idx, Remesh};
use crate::core::vec::{V3, length, normalize_or_down};
use super::prims::{newell, to_web};
use super::{LEAF, PointId};
use std::collections::HashMap;

/// Vertices in OpenVDB order, faces in Blender's order and their normals (`None` for a zero-area face).
pub struct FullMesh {
    pub vertices: Vec<V3>,
    pub faces: Vec<Vec<u32>>,
    pub normals: Vec<Option<V3>>,
}

impl Remesh {
    /// Vertices in OpenVDB order (leaf by leaf; in a leaf, unmerged cell points by voxel offset, then
    /// region points by region id) and faces in Blender's order (every triangle, then every quad,
    /// each leaf by leaf). Zero-area faces keep their place with no normal. Positions are web space.
    pub fn full_mesh(&mut self) -> FullMesh {
        let h = self.voxel;
        let (min, max) = self.bounds;
        // Blender index space: (x, -z, y) of web.
        let lo = [min[0], -max[2], min[1]].map(|v| ((v / h).floor() as i32).div_euclid(LEAF) - 1);
        let hi = [max[0], -min[2], max[1]].map(|v| ((v / h).floor() as i32).div_euclid(LEAF) + 1);
        let mut origins: Vec<Idx> = Vec::new();
        for i in lo[0]..=hi[0] {
            for j in lo[1]..=hi[1] {
                for k in lo[2]..=hi[2] {
                    origins.push([i * LEAF, j * LEAF, k * LEAF]);
                }
            }
        }
        // OpenVDB tree order: root children by origin (x, y, z), then child offsets x-major at each
        // internal level (4096 and 128 voxels).
        let order = |c: Idx| -> [i32; 9] {
            let mut key = [0; 9];
            for (n, size) in [4096, 128, 8].into_iter().enumerate() {
                for a in 0..3 {
                    key[n * 3 + a] = c[a].div_euclid(size);
                }
            }
            key
        };
        origins.sort_by_key(|&c| order(c));
        let mut index: HashMap<PointId, u32> = HashMap::new();
        let mut vertices: Vec<V3> = Vec::new();
        let mut triangles: Vec<Vec<u32>> = Vec::new();
        let mut quads: Vec<Vec<u32>> = Vec::new();
        for origin in origins {
            if !self.leaf_can_have_surface(origin) {
                continue;
            }
            let leaf = self.leaf(origin);
            let cells = self.leaf_cells(origin);
            let mut id_of = |me: &mut Remesh, id: PointId| -> u32 {
                if let Some(&n) = index.get(&id) {
                    return n;
                }
                let n = vertices.len() as u32;
                index.insert(id, n);
                vertices.push(to_web(me.final_point(id)));
                n
            };
            for &c in &cells {
                if leaf.region.contains_key(&c) {
                    continue;
                }
                for group in 1..=self.group_count(c) {
                    id_of(self, PointId::Cell(c, group));
                }
            }
            for &region in leaf.members.keys() {
                id_of(self, PointId::Region(origin, region));
            }
            for &c in &cells {
                for axis in 0..3u8 {
                    if let Some(p) = self.prim(c, axis) {
                        let prim = &self.prims[p];
                        let (ids, is_triangle) = (prim.ids.clone(), prim.triangle);
                        let face: Vec<u32> = ids.into_iter().map(|id| id_of(self, id)).collect();
                        if is_triangle { triangles.push(face) } else { quads.push(face) }
                    }
                }
            }
        }
        let mut faces = triangles;
        faces.extend(quads);
        let normals = faces
            .iter()
            .map(|face| {
                let corners: Vec<V3> = face.iter().map(|&v| vertices[v as usize]).collect();
                let normal = newell(&corners);
                if length(normal) < 1e-12 { None } else { Some(normalize_or_down(normal)) }
            })
            .collect();
        FullMesh { vertices, faces, normals }
    }
}
