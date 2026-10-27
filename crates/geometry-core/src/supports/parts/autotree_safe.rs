//! Auto Tree eligibility with Safe Distance != 0: the scatter takes the model's non-overhang faces
//! from its remesh R (voxel Spacing / 4), each corner carrying the vertex normal of that separated
//! mesh, and moves them out and in by Safe Distance. A contact whose straight-down ray (from
//! Spacing/32 below it) hits the outward copy cannot branch; one that hits the outward copy but not
//! the inward copy is deleted.

use crate::supports::remesh::{PointId, Polygon, Remesh};
use super::vec::{V3, add, scale};
use std::collections::HashMap;

pub type Tri = [V3; 3];

pub struct SafeScatter<'a> {
    remesh: &'a mut Remesh,
    limit: f64,
    safe: f64,
    normals: HashMap<PointId, V3>,
}

impl<'a> SafeScatter<'a> {
    pub fn new(remesh: &'a mut Remesh, limit: f64, safe: f64) -> Self {
        Self { remesh, limit, safe, normals: HashMap::new() }
    }

    /// R's non-overhang faces near the ray from `from` straight down over `length`, moved out (first
    /// list) and in (second list) by Safe Distance along their vertex normals.
    pub fn blockers(&mut self, from: V3, length: f64) -> (Vec<Tri>, Vec<Tri>) {
        let limit = self.limit;
        let keep = move |p: &Polygon| (-p.normal[1]).clamp(-1.0, 1.0).acos() > limit;
        let reach = self.safe.abs();
        let voxel = self.remesh.voxel;
        // Corners move at most Safe Distance, so only polygons within that of the ray can be hit.
        let near = |p: &Polygon| {
            let (mut x0, mut x1, mut z0, mut z1) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
            for c in &p.corners {
                x0 = x0.min(c[0]);
                x1 = x1.max(c[0]);
                z0 = z0.min(c[2]);
                z1 = z1.max(c[2]);
            }
            from[0] >= x0 - reach && from[0] <= x1 + reach && from[2] >= z0 - reach && from[2] <= z1 + reach
        };
        let polygons: Vec<_> = self
            .remesh
            .polygons_near_column(from[0], from[2], reach + voxel, from[1] + reach + voxel, from[1] - length - reach)
            .into_iter()
            .filter(|p| near(p) && keep(p))
            .collect();
        let mut moved = |sign: f64| -> Vec<Tri> {
            let mut out = Vec::new();
            for polygon in &polygons {
                let corners: Vec<V3> = polygon
                    .corners
                    .iter()
                    .zip(&polygon.vertices)
                    .map(|(corner, id)| {
                        let normal = *self.normals.entry(*id).or_insert_with(|| self.remesh.vertex_normal(*id, &keep));
                        add(*corner, scale(normal, sign * self.safe))
                    })
                    .collect();
                for k in 1..corners.len() - 1 {
                    out.push([corners[0], corners[k], corners[k + 1]]);
                }
            }
            out
        };
        let outward = moved(1.0);
        let inward = moved(-1.0);
        (outward, inward)
    }
}

/// Whether the vertical line through `from` meets a triangle within `length` below it.
pub fn hits_below(triangles: &[Tri], from: V3, length: f64) -> bool {
    triangles.iter().any(|[a, b, c]| {
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
