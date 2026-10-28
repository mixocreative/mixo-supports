//! Pose restoration: the arch front (which end of the U is the front teeth) and the Euler XYZ
//! rotation that maps a scanned aligner onto the owner-approved reference pose.

use super::mesh::Mesh;

use crate::core::vec::{V3, cross, dot, normalize, sub};
use crate::core::jsnum::hypot3;
use super::rim::Rim;
use std::collections::HashSet;

/// Reference opening and arch-front directions (the owner-approved, already-correct pose).
const TARGET_OPENING: V3 = [0.03714905735095951, -0.6888892651222808, -0.7239140335269232];
const TARGET_FRONT: V3 = [-0.01322175449610946, 0.7240118281038878, -0.6896608282146458];

/// Euler XYZ rotation (radians) that restores the reference pose, or `None` for an ambiguous arch.
/// A convenience proposal, not a universal clinical print orientation.
pub fn rotation_to_dental_pose(mesh: &Mesh, rim: &Rim) -> Option<[f64; 3]> {
    let front = estimate_arch_front(mesh, rim)?;
    let target_opening = normalize(TARGET_OPENING);
    let target_front = normalize(TARGET_FRONT);
    let target_side = normalize(cross(target_front, target_opening));
    let source_side = normalize(cross(front, rim.opening_direction));
    let source = [source_side, front, rim.opening_direction];
    let target = [target_side, target_front, target_opening];
    let at = |row: usize, column: usize| target.iter().enumerate().fold(0.0, |sum, (index, axis)| sum + axis[row] * source[index][column]);
    let (m11, m12, m13) = (at(0, 0), at(0, 1), at(0, 2));
    let (m22, m23) = (at(1, 1), at(1, 2));
    let (m32, m33) = (at(2, 1), at(2, 2));
    let y = m13.clamp(-1.0, 1.0).asin();
    Some(if m13.abs() < 0.9999999 {
        [(-m23).atan2(m33), y, (-m12).atan2(m11)]
    } else {
        [m32.atan2(m22), y, 0.0]
    })
}

fn estimate_arch_front(mesh: &Mesh, rim: &Rim) -> Option<V3> {
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
    if spread / (suu + svv).max(1e-9) < 0.05 {
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
    let mut ends: [HashSet<i64>; 2] = [HashSet::new(), HashSet::new()];
    for [x, y] in &plane {
        let fx = (x - min_x) / (max_x - min_x);
        if fx <= 0.3 || fx >= 0.7 {
            continue;
        }
        let fy = (y - min_y) / (max_y - min_y);
        let end = if fy < 0.22 { 0 } else if fy > 0.78 { 1 } else { continue };
        ends[end].insert((fx * 40.0).floor() as i64 * 40 + (fy * 40.0).floor() as i64);
    }
    let (first, second) = (ends[0].len(), ends[1].len());
    if first.max(second) < 20 || first.max(second) < 2 * 1.max(first.min(second)) {
        return None;
    }
    let sign = if first > second { -1.0 } else { 1.0 };
    Some(normalize([
        sign * (minor[0] * rim.tangent[0] + minor[1] * rim.bitangent[0]),
        sign * (minor[0] * rim.tangent[1] + minor[1] * rim.bitangent[1]),
        sign * (minor[0] * rim.tangent[2] + minor[1] * rim.bitangent[2]),
    ]))
}
