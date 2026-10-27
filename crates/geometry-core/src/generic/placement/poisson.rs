//! Distribute Points on Faces (POISSON) on the overhang faces of the remesh R (true normal within
//! Overhang Angle of straight down), triangle by triangle in Blender's order: quads split along 0-2,
//! each triangle seeded with hash(triangle index, 0), Density Max = (1/Spacing)^4; then every point
//! within Spacing of an earlier kept point is eliminated.

use super::downward::face_overhang_limit;
use super::random::{Drand48, hash_pair};
use super::{Candidate, PlacementSettings, Source};
use crate::supports::remesh::{V3, hypot3};
use std::collections::HashMap;

pub fn poisson_on_remesh(vertices: &[V3], faces: &[Vec<u32>], normals: &[Option<V3>], s: &PlacementSettings) -> Vec<Candidate> {
    let spacing = s.spacing;
    let density = (1.0 / spacing).powf(4.0);
    let limit = face_overhang_limit(s.overhang_angle_degrees) * std::f64::consts::PI / 180.0;
    let mut raw: Vec<Candidate> = Vec::new();
    let mut triangle: u32 = 0;
    for (f, face) in faces.iter().enumerate() {
        let Some(normal) = normals[f] else { continue };
        if (-normal[1]).clamp(-1.0, 1.0).acos() > limit {
            continue;
        }
        for k in 1..face.len() - 1 {
            let (a, b, c) = (vertices[face[0] as usize], vertices[face[k] as usize], vertices[face[k + 1] as usize]);
            let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
            let area = hypot3(cross) / 2.0;
            let mut rng = Drand48::new(hash_pair(triangle, 0));
            triangle += 1;
            let amount = area * density;
            let whole = amount.floor();
            let count = whole + if (amount - whole) > rng.next() { 1.0 } else { 0.0 };
            for _ in 0..count as usize {
                let mut r1 = rng.next();
                let mut r2 = rng.next();
                if r1 + r2 > 1.0 {
                    r1 = 1.0 - r1;
                    r2 = 1.0 - r2;
                }
                let r3 = 1.0 - r1 - r2;
                let position = [0, 1, 2].map(|i| (a[i] * r1 + b[i] * r2) + c[i] * r3);
                raw.push(Candidate { position, normal, source: Source::Interior });
            }
        }
    }
    let mut kept = Vec::new();
    let mut grid: HashMap<(i64, i64, i64), Vec<usize>> = HashMap::new();
    let cell = |p: &V3| ((p[0] / spacing).floor() as i64, (p[1] / spacing).floor() as i64, (p[2] / spacing).floor() as i64);
    for (index, point) in raw.iter().enumerate() {
        grid.entry(cell(&point.position)).or_default().push(index);
    }
    let mut eliminated = vec![false; raw.len()];
    for (index, point) in raw.iter().enumerate() {
        if eliminated[index] {
            continue;
        }
        kept.push(*point);
        let (cx, cy, cz) = cell(&point.position);
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    for &other in grid.get(&(cx + dx, cy + dy, cz + dz)).map(Vec::as_slice).unwrap_or(&[]) {
                        let o = raw[other].position;
                        let d = hypot3([point.position[0] - o[0], point.position[1] - o[1], point.position[2] - o[2]]);
                        if d <= spacing && other != index {
                            eliminated[other] = true;
                        }
                    }
                }
            }
        }
    }
    kept
}
