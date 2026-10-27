//! Batched ray and screen picks against a mesh's BVH. Never per face or per pixel: one call takes
//! a whole batch of rays (or canvas pixels) and returns one record per ray.

use super::matrix::{Matrix4, apply_to_point};
use super::spatial::{Bvh, Side};

/// Floats per pick result: face id (-1 for a miss), distance, x, y, z.
pub const PICK_STRIDE: usize = 5;

/// First hit of each ray (`origin xyz, direction xyz` per ray, mesh-local, direction unit length).
pub fn pick_rays(positions: &[f32], indices: &[u32], bvh: &Bvh, rays: &[f64], near: f64, far: f64, side: Side) -> Vec<f64> {
    let mut out = Vec::with_capacity(rays.len() / 6 * PICK_STRIDE);
    for ray in rays.chunks_exact(6) {
        let origin = [ray[0], ray[1], ray[2]];
        let direction = [ray[3], ray[4], ray[5]];
        match bvh.raycast_first(positions, indices, origin, direction, near, far, side) {
            Some(hit) => out.extend_from_slice(&[f64::from(hit.face), hit.distance, hit.point[0], hit.point[1], hit.point[2]]),
            None => out.extend_from_slice(&[-1.0, 0.0, 0.0, 0.0, 0.0]),
        }
    }
    out
}

/// Mesh-local rays through canvas pixels (`x, y` per pixel, y down). `clip_to_local` is the inverse
/// of (projection * view * model). The ray starts on the near plane and runs toward the far plane.
pub fn pixel_rays(clip_to_local: &Matrix4, width: f64, height: f64, pixels: &[f64]) -> Vec<f64> {
    let mut out = Vec::with_capacity(pixels.len() * 3);
    for pixel in pixels.chunks_exact(2) {
        let x = pixel[0] / width * 2.0 - 1.0;
        let y = 1.0 - pixel[1] / height * 2.0;
        let near = apply_to_point(clip_to_local, x, y, -1.0);
        let far = apply_to_point(clip_to_local, x, y, 1.0);
        let d = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
        let length = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        let scale = 1.0 / if length == 0.0 { 1.0 } else { length };
        out.extend_from_slice(&[near[0], near[1], near[2], d[0] * scale, d[1] * scale, d[2] * scale]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::matrix::invert_matrix;

    #[test]
    fn pixel_pick_finds_the_triangle_under_the_pixel_and_reports_misses() {
        let positions = [-1.0f32, -1.0, 0.0, 1.0, -1.0, 0.0, 0.0, 1.0, 0.0];
        let indices = [0u32, 1, 2];
        let bvh = Bvh::build(&positions, &indices);
        // Orthographic camera looking down -Z over x,y in [-2, 2], near 0.1, far 10, eye at z = 5.
        let (r, n, f) = (2.0, 0.1, 10.0);
        let projection: Matrix4 = [1.0 / r, 0.0, 0.0, 0.0, 0.0, 1.0 / r, 0.0, 0.0, 0.0, 0.0, -2.0 / (f - n), 0.0, 0.0, 0.0, -(f + n) / (f - n), 1.0];
        let view: Matrix4 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, -5.0, 1.0];
        let mut clip = [0.0; 16];
        for c in 0..4 {
            for r_ in 0..4 {
                clip[c * 4 + r_] = (0..4).map(|k| projection[k * 4 + r_] * view[c * 4 + k]).sum();
            }
        }
        let rays = pixel_rays(&invert_matrix(&clip), 100.0, 100.0, &[50.0, 50.0, 2.0, 2.0]);
        let hits = pick_rays(&positions, &indices, &bvh, &rays, 0.0, 100.0, Side::Double);
        assert_eq!(hits[0], 0.0);
        assert!((hits[1] - 4.9).abs() < 1e-9, "the ray starts on the near plane");
        assert_eq!(hits[PICK_STRIDE], -1.0);
    }
}
