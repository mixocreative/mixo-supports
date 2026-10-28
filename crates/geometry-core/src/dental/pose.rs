//! Pose restoration: the arch front (which end of the U is the front teeth) and the Euler XYZ
//! rotation that maps a scanned aligner onto the owner-approved reference pose.

use super::mesh::Mesh;

use crate::core::vec::{V3, cross, dot, normalize, sub};
use crate::core::jsnum::hypot3;
use super::profiles::{AlignerProfile, Pose, Thresholds};
use super::rim::Rim;
use std::collections::HashSet;

/// The profile's target opening and arch-front directions (build plate normal +Y). The opening
/// axis is tilted from the downward plate normal by `tilt_deg` toward `heading_deg`; the front is
/// the direction of increasing tilt (plate-up across the opening axis), rolled by `roll_deg` about it.
pub fn target_frame(pose: &Pose) -> (V3, V3) {
    let (tilt, heading, roll) = (pose.tilt_deg.to_radians(), pose.heading_deg.to_radians(), pose.roll_deg.to_radians());
    let opening = [tilt.sin() * heading.sin(), -tilt.cos(), -tilt.sin() * heading.cos()];
    // The direction of increasing tilt: plate-up across the opening axis, defined at tilt 0 too.
    let up = [tilt.cos() * heading.sin(), tilt.sin(), -tilt.cos() * heading.cos()];
    let across = normalize(cross(up, opening));
    let front = std::array::from_fn(|axis| roll.cos() * up[axis] + roll.sin() * across[axis]);
    (opening, front)
}

/// Euler XYZ rotation (radians) that restores the profile's target pose, or `None` for an
/// ambiguous arch. A convenience proposal, not a universal clinical print orientation.
pub fn rotation_to_dental_pose(mesh: &Mesh, rim: &Rim, profile: &AlignerProfile) -> Option<[f64; 3]> {
    Some(euler_to_pose(&source_frame(mesh, rim, &profile.thresholds)?, &profile.pose))
}

/// The aligner's own frame in the mesh: side, arch front and opening axis (the rows the target
/// frame's side, front and opening are matched to), or `None` for an ambiguous arch.
pub fn source_frame(mesh: &Mesh, rim: &Rim, t: &Thresholds) -> Option<[V3; 3]> {
    let front = estimate_arch_front(mesh, rim, t)?;
    let source_side = normalize(cross(front, rim.opening_direction));
    Some([source_side, front, rim.opening_direction])
}

/// The target frame of `pose` as side, front and opening (build plate normal +Y).
fn target_axes(pose: &Pose) -> [V3; 3] {
    let (target_opening, target_front) = target_frame(pose);
    let target_side = normalize(cross(target_front, target_opening));
    [target_side, target_front, target_opening]
}

/// Entry (row, column) of the rotation that maps the `source` frame onto `pose`'s target frame.
fn pose_matrix(source: &[V3; 3], pose: &Pose) -> [[f64; 3]; 3] {
    let target = target_axes(pose);
    std::array::from_fn(|row| std::array::from_fn(|column| target.iter().enumerate().fold(0.0, |sum, (index, axis)| sum + axis[row] * source[index][column])))
}

/// Euler XYZ rotation (radians) that turns the `source` frame into `pose`'s target frame.
pub fn euler_to_pose(source: &[V3; 3], pose: &Pose) -> [f64; 3] {
    let m = pose_matrix(source, pose);
    let (m11, m12, m13) = (m[0][0], m[0][1], m[0][2]);
    let (m22, m23) = (m[1][1], m[1][2]);
    let (m32, m33) = (m[2][1], m[2][2]);
    let y = m13.clamp(-1.0, 1.0).asin();
    if m13.abs() < 0.9999999 {
        [(-m23).atan2(m33), y, (-m12).atan2(m11)]
    } else {
        [m32.atan2(m22), y, 0.0]
    }
}

/// The build plate normal (+Y) of `pose` in the mesh frame, when the `source` frame is turned
/// onto `pose`'s target frame (the transposed rotation applied to +Y).
pub fn plate_up_in_mesh(source: &[V3; 3], pose: &Pose) -> V3 {
    let m = pose_matrix(source, pose);
    normalize([m[1][0], m[1][1], m[1][2]])
}

fn estimate_arch_front(mesh: &Mesh, rim: &Rim, t: &Thresholds) -> Option<V3> {
    let count = mesh.vertex_count();
    if count < 32 {
        return None;
    }
    let projected: Vec<[f64; 2]> = (0..count as u32)
        .map(|index| {
            let delta = sub(mesh.point(index), rim.centroid);
            [dot(delta, rim.tangent), dot(delta, rim.bitangent)]
        })
        .collect();
    let (mut mean_u, mut mean_v) = (0.0, 0.0);
    for [u, v] in &projected {
        mean_u += u;
        mean_v += v;
    }
    mean_u /= count as f64;
    mean_v /= count as f64;
    let (mut suu, mut svv, mut suv) = (0.0, 0.0, 0.0);
    for [u, v] in &projected {
        let (du, dv) = (u - mean_u, v - mean_v);
        suu += du * du;
        svv += dv * dv;
        suv += du * dv;
    }
    let spread = hypot3([suu - svv, 2.0 * suv, 0.0]);
    if spread / (suu + svv).max(1e-9) < t.arch_front_min_anisotropy {
        return None;
    }
    let theta = 0.5 * (2.0 * suv).atan2(suu - svv);
    let major = [theta.cos(), theta.sin()];
    let minor = [-major[1], major[0]];
    let plane: Vec<[f64; 2]> = projected
        .iter()
        .map(|[u, v]| {
            let (du, dv) = (u - mean_u, v - mean_v);
            [du * major[0] + dv * major[1], du * minor[0] + dv * minor[1]]
        })
        .collect();
    let (mut min_x, mut max_x, mut min_y, mut max_y) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    for [x, y] in &plane {
        min_x = min_x.min(*x);
        max_x = max_x.max(*x);
        min_y = min_y.min(*y);
        max_y = max_y.max(*y);
    }
    if !(max_x > min_x) || !(max_y > min_y) {
        return None;
    }
    // Occupied cells of a grid over the part's own in-plane box: an area fraction, not a mesh count.
    let grid = t.arch_front_grid_cells as f64;
    let (side, band) = (t.arch_front_side_fraction, t.arch_front_end_band_fraction);
    let mut ends: [HashSet<i64>; 2] = [HashSet::new(), HashSet::new()];
    for [x, y] in &plane {
        let fx = (x - min_x) / (max_x - min_x);
        if fx <= side || fx >= 1.0 - side {
            continue;
        }
        let fy = (y - min_y) / (max_y - min_y);
        let end = if fy < band { 0 } else if fy > 1.0 - band { 1 } else { continue };
        ends[end].insert((fx * grid).floor() as i64 * t.arch_front_grid_cells as i64 + (fy * grid).floor() as i64);
    }
    let (first, second) = (ends[0].len() as f64, ends[1].len() as f64);
    if first.max(second) < t.arch_front_min_area_fraction * grid * grid || first.max(second) < t.arch_front_end_ratio_min * first.min(second).max(1.0) {
        return None;
    }
    let sign = if first > second { -1.0 } else { 1.0 };
    Some(normalize([
        sign * (minor[0] * rim.tangent[0] + minor[1] * rim.bitangent[0]),
        sign * (minor[0] * rim.tangent[1] + minor[1] * rim.bitangent[1]),
        sign * (minor[0] * rim.tangent[2] + minor[1] * rim.bitangent[2]),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dental::profiles::reference_aligner;

    /// The reference profile's pose block reproduces the owner-approved directions it replaced.
    #[test]
    fn the_reference_pose_block_reproduces_the_approved_directions() {
        let (opening, front) = target_frame(&reference_aligner().pose);
        let approved_opening = [0.03714905735095951, -0.6888892651222808, -0.7239140335269232];
        let approved_front = [-0.01322175449610946, 0.7240118281038878, -0.6896608282146458];
        for axis in 0..3 {
            assert!((opening[axis] - approved_opening[axis]).abs() < 1e-12, "{opening:?}");
            assert!((front[axis] - approved_front[axis]).abs() < 1e-12, "{front:?}");
        }
        assert!(dot(opening, front).abs() < 1e-12);
        let flat = target_frame(&Pose { tilt_deg: 0.0, heading_deg: 0.0, roll_deg: 0.0, ..reference_aligner().pose.clone() });
        assert_eq!(flat.0, [0.0, -1.0, -0.0]);
        assert!((flat.1[2] - -1.0).abs() < 1e-12, "with no tilt the front lies along -Z: {:?}", flat.1);
    }
}
