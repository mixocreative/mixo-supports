//! Points, primitives (quads and triangles) and polygons of the remesh: OpenVDB's
//! AdaptivePrimBuilder, the relaxation of disoriented triangles and the web-space polygon of each
//! primitive.

use super::grid::{Idx, Remesh};
use super::num::{V3, add, cross, dot, fr, length, normalize_or_down, scale, sub};
use super::{LEAF, PointId, Polygon, Prim};
use std::rc::Rc;

pub fn to_web([x, y, z]: V3) -> V3 {
    [x, z, -y]
}

/// AdaptivePrimBuilder: a quad, a triangle where two corners share a point, or nothing.
fn collapse(v: &[PointId; 4], reverse: bool) -> Option<Prim> {
    let [a, b, c, d] = *v;
    let tri = |x: PointId, y: PointId, z: PointId| Prim { ids: if reverse { vec![z, y, x] } else { vec![x, y, z] }, triangle: true };
    if a != b && a != c && a != d && b != c && b != d && c != d {
        return Some(Prim { ids: if reverse { vec![d, c, b, a] } else { vec![a, b, c, d] }, triangle: false });
    }
    if a == d && b != c && b != a && c != a {
        return Some(tri(a, b, c));
    }
    if b == c && a != d && a != b && d != b {
        return Some(tri(a, b, d));
    }
    if a == b && c != d && c != a && d != a {
        return Some(tri(a, c, d));
    }
    if c == d && a != b && a != c && b != c {
        return Some(tri(a, b, c));
    }
    None
}

/// Newell normal sum of a polygon (web space).
pub fn newell(corners: &[V3]) -> V3 {
    let mut normal = [0.0; 3];
    for (n, p) in corners.iter().enumerate() {
        let q = corners[(n + 1) % corners.len()];
        normal = add(normal, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
    }
    normal
}

impl Remesh {
    pub(super) fn vertex_cells(&mut self, id: PointId) -> Vec<Idx> {
        match id {
            PointId::Region(origin, region) => self.leaf(origin).members.get(&region).cloned().unwrap_or_default(),
            PointId::Cell(c, _) => vec![c],
        }
    }

    /// Point before relaxation, Blender world space (single precision).
    pub(super) fn raw_point(&mut self, id: PointId) -> V3 {
        if let Some(p) = self.raw.get(&id) {
            return *p;
        }
        let h = self.voxel;
        let point = match id {
            PointId::Region(..) => {
                let cells = self.vertex_cells(id);
                let mut sum = [0.0; 3];
                for c in &cells {
                    let cf = [f64::from(c[0]), f64::from(c[1]), f64::from(c[2])];
                    let gp = self.group_point(*c, 1);
                    sum = add(sum, add(cf, gp));
                }
                scale(sum, h / cells.len() as f64)
            }
            PointId::Cell(c, group) => {
                let cf = [f64::from(c[0]), f64::from(c[1]), f64::from(c[2])];
                let gp = self.group_point(c, group);
                scale(add(cf, gp), h)
            }
        };
        let point = [fr(point[0]), fr(point[1]), fr(point[2])];
        self.raw.insert(id, point);
        point
    }

    /// The OpenVDB primitive of the grid edge from node `n` along `axis`, if it crosses the surface.
    pub(super) fn prim(&mut self, n: Idx, axis: u8) -> Option<usize> {
        if let Some(&r) = self.prim_cache.get(&(n, axis)) {
            return r;
        }
        let next = [n[0] + i32::from(axis == 0), n[1] + i32::from(axis == 1), n[2] + i32::from(axis == 2)];
        let is_inside = self.inside(n);
        let mut result = None;
        if is_inside != self.inside(next) {
            let [i, j, k] = n;
            // Neighbour cells and the table edge that names the shared edge in each of them.
            let ring: [(Idx, usize); 4] = match axis {
                0 => [(n, 1), ([i, j - 1, k], 5), ([i, j - 1, k - 1], 7), ([i, j, k - 1], 3)],
                1 => [(n, 9), ([i, j, k - 1], 12), ([i - 1, j, k - 1], 11), ([i - 1, j, k], 10)],
                _ => [(n, 4), ([i, j - 1, k], 8), ([i - 1, j - 1, k], 6), ([i - 1, j, k], 2)],
            };
            let mut ids = [PointId::Cell([0; 3], 0); 4];
            for (slot, (c, edge)) in ring.into_iter().enumerate() {
                let groups = self.edge_groups(c);
                let group = if groups[0] > 1 { groups[edge] } else { 1 };
                ids[slot] = self.point_id(c, group);
            }
            // Blender's SDF grid is not tagged as a level set, so OpenVDB inverts the orientation.
            let reverse = if axis == 2 { is_inside } else { !is_inside };
            if let Some(prim) = collapse(&ids, reverse) {
                self.prims.push(prim);
                result = Some(self.prims.len() - 1);
            }
        }
        self.prim_cache.insert((n, axis), result);
        result
    }

    /// Primitives of the twelve edges of cell `c`, without repeats.
    fn cell_prims(&mut self, [i, j, k]: Idx) -> Vec<usize> {
        let mut out: Vec<usize> = Vec::new();
        for a in 0..=1 {
            for b in 0..=1 {
                for p in [self.prim([i, j + a, k + b], 0), self.prim([i + a, j, k + b], 1), self.prim([i + a, j + b, k], 2)].into_iter().flatten() {
                    if !out.contains(&p) {
                        out.push(p);
                    }
                }
            }
        }
        out
    }

    pub(super) fn star_prims(&mut self, id: PointId) -> Vec<usize> {
        let mut out: Vec<usize> = Vec::new();
        for c in self.vertex_cells(id) {
            for p in self.cell_prims(c) {
                if self.prims[p].ids.contains(&id) && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
        out
    }

    /// relaxDisorientedTriangles: final point position, Blender world space.
    pub(super) fn final_point(&mut self, id: PointId) -> V3 {
        if let Some(p) = self.final_points.get(&id) {
            return *p;
        }
        let mut point = self.raw_point(id);
        if self.adaptivity > 1e-7 {
            let star = self.star_prims(id);
            let mut any = false;
            for &p in &star {
                if self.prims[p].triangle && self.disoriented(p) {
                    any = true;
                    break;
                }
            }
            if any {
                let mut sum = [0.0; 3];
                let mut count = 0usize;
                for &p in &star {
                    let ids = self.prims[p].ids.clone();
                    for v in &ids {
                        sum = add(sum, self.raw_point(*v));
                    }
                    count += ids.len();
                }
                let s = scale(sum, 1.0 / count as f64);
                point = [fr(s[0]), fr(s[1]), fr(s[2])];
            }
        }
        self.final_points.insert(id, point);
        point
    }

    fn disoriented(&mut self, prim: usize) -> bool {
        let ids = self.prims[prim].ids.clone();
        let (v0, v1, v2) = (self.raw_point(ids[0]), self.raw_point(ids[1]), self.raw_point(ids[2]));
        let normal = normalize_or_down(cross(sub(v2, v0), sub(v1, v0)));
        let centroid = scale(add(add(v0, v1), v2), 1.0 / 3.0);
        let cell = [0, 1, 2].map(|a| (centroid[a] / self.voxel + 0.5).floor() as i32);
        // The inverted orientation flips the gradient too (invertGradientDir).
        -dot(self.gradient(cell), normal) < -0.5
    }

    /// Web-space polygon of a primitive.
    pub(super) fn polygon(&mut self, prim: usize) -> Option<Rc<Polygon>> {
        if let Some(p) = self.polygon_cache.get(&prim) {
            return p.clone();
        }
        let ids = self.prims[prim].ids.clone();
        let corners: Vec<V3> = ids.iter().map(|id| to_web(self.final_point(*id))).collect();
        let normal = newell(&corners);
        // Coincident points (the surface through grid nodes) give zero-area faces with no normal.
        let result = if length(normal) < 1e-12 { None } else { Some(Rc::new(Polygon { id: prim, corners, vertices: ids, normal: normalize_or_down(normal) })) };
        self.polygon_cache.insert(prim, result.clone());
        result
    }

    pub(super) fn star(&mut self, id: PointId) -> Vec<Rc<Polygon>> {
        let prims = self.star_prims(id);
        prims.into_iter().filter_map(|p| self.polygon(p)).collect()
    }

    /// Polygons of the edges owned by cells of one leaf.
    pub(super) fn leaf_polygons(&mut self, origin: Idx) -> Rc<Vec<Rc<Polygon>>> {
        if let Some(out) = self.leaf_polygon_cache.get(&origin) {
            return out.clone();
        }
        let mut out: Vec<Rc<Polygon>> = Vec::new();
        if self.leaf_can_have_surface(origin) {
            let mut seen: std::collections::HashSet<usize> = std::collections::HashSet::new();
            for i in 0..LEAF {
                for j in 0..LEAF {
                    for k in 0..LEAF {
                        let n = [origin[0] + i, origin[1] + j, origin[2] + k];
                        for axis in 0..3u8 {
                            let Some(p) = self.prim(n, axis) else { continue };
                            if !seen.insert(p) {
                                continue;
                            }
                            if let Some(polygon) = self.polygon(p) {
                                out.push(polygon);
                            }
                        }
                    }
                }
            }
        }
        let rc = Rc::new(out);
        self.leaf_polygon_cache.insert(origin, rc.clone());
        rc
    }
}
