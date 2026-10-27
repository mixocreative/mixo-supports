//! Support check (port of TS `supportCheck.ts`, the last generic geometry that ran in TypeScript):
//! what the contacts leave unsupported, the way a resin print fails. Decision D1 (SHIP-PLAN): the
//! overhang-coverage report is a non-gating generic-policy warning (Check is a shipped generic
//! feature); the built-path island verdict of `generate` (`safety::paths`) is the gating island
//! answer, this file's island heuristic only measures contact distance on the source mesh.
//!
//! - islands: downward-facing local lowest points (a flat bottom counts once) with no contact within
//!   one Support spacing; each would start printing in mid-air;
//! - overhangs: faces steeper than the Overhang angle from straight down whose surface lies more than
//!   `COVER_FACTOR` x spacing from every contact.
//! Spots are clustered (2 x spacing) and slivers below a quarter spacing squared are ignored.

use super::parts::vec::V3;
use crate::generic::placement::face_overhang_limit;
use crate::supports::remesh::hypot3;
use std::collections::HashMap;

/// A contact covers overhang within this many Support spacings.
pub const COVER_FACTOR: f64 = 1.5;
const MAX_PROBLEMS: usize = 50;
const MAX_SAMPLES: f64 = 200_000.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProblemKind {
    Island,
    Overhang,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SupportProblem {
    pub kind: ProblemKind,
    /// Centre of the spot, in the frame of the checked mesh (Y up).
    pub position: V3,
    /// Unsupported overhang area in mm² (0 for a lone island point).
    pub area: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct CheckSettings {
    pub overhang_angle_degrees: f64,
    pub spacing: f64,
}

struct SpatialHash {
    size: f64,
    cells: HashMap<(i64, i64, i64), Vec<V3>>,
}

impl SpatialHash {
    fn key(&self, p: V3) -> (i64, i64, i64) {
        ((p[0] / self.size).floor() as i64, (p[1] / self.size).floor() as i64, (p[2] / self.size).floor() as i64)
    }
    fn add(&mut self, p: V3) {
        let key = self.key(p);
        self.cells.entry(key).or_default().push(p);
    }
    fn any(&self, p: V3, radius: f64) -> bool {
        let reach = (radius / self.size).ceil() as i64;
        let (cx, cy, cz) = self.key(p);
        for x in cx - reach..=cx + reach {
            for y in cy - reach..=cy + reach {
                for z in cz - reach..=cz + reach {
                    for other in self.cells.get(&(x, y, z)).map_or(&[][..], Vec::as_slice) {
                        if hypot3([other[0] - p[0], other[1] - p[1], other[2] - p[2]]) <= radius {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }
}

fn at(p: &[f32], v: u32) -> V3 {
    let o = v as usize * 3;
    [f64::from(p[o]), f64::from(p[o + 1]), f64::from(p[o + 2])]
}

fn face_normal(p: &[f32], a: u32, b: u32, c: u32) -> V3 {
    let (pa, pb, pc) = (at(p, a), at(p, b), at(p, c));
    let (ux, uy, uz) = (pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    let (vx, vy, vz) = (pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]);
    [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}

fn barycentric(p: &[f32], a: u32, b: u32, c: u32, u: f64, w: f64) -> V3 {
    let s = 1.0 - u - w;
    let (pa, pb, pc) = (at(p, a), at(p, b), at(p, c));
    [0, 1, 2].map(|k| pa[k] * s + pb[k] * u + pc[k] * w)
}

struct Spot {
    kind: ProblemKind,
    position: V3,
    area: f64,
}

pub fn check_supports(positions: &[f32], indices: &[u32], contacts: &[V3], settings: &CheckSettings) -> Vec<SupportProblem> {
    let spacing = settings.spacing;
    let vertex_count = positions.len() / 3;
    let mut near = SpatialHash { size: spacing * COVER_FACTOR, cells: HashMap::new() };
    for &contact in contacts {
        near.add(contact);
    }
    let covered = |point: V3, radius: f64| near.any(point, radius);

    // Vertex normals (area weighted, accumulated in single precision as the oracle does) and
    // neighbours (CSR arrays keep memory flat on big meshes).
    let mut normals = vec![0f32; positions.len()];
    let mut degree = vec![0i32; vertex_count + 1];
    for t in indices.chunks_exact(3) {
        let n = face_normal(positions, t[0], t[1], t[2]);
        for &v in t {
            for k in 0..3 {
                let slot = v as usize * 3 + k;
                normals[slot] = (f64::from(normals[slot]) + n[k]) as f32;
            }
            degree[v as usize + 1] += 2;
        }
    }
    for v in 0..vertex_count {
        degree[v + 1] += degree[v];
    }
    let mut neighbours = vec![0i32; degree[vertex_count] as usize];
    let mut fill: Vec<i32> = degree[..vertex_count].to_vec();
    for t in indices.chunks_exact(3) {
        let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
        for (v, p, q) in [(a, b, c), (b, c, a), (c, a, b)] {
            neighbours[fill[v] as usize] = p as i32;
            fill[v] += 1;
            neighbours[fill[v] as usize] = q as i32;
            fill[v] += 1;
        }
    }

    let mut spots: Vec<Spot> = Vec::new();
    // Downward-facing vertices joined into plateaus of equal height (a flat bottom is one).
    let epsilon = 1e-5;
    let y = |v: usize| f64::from(positions[v * 3 + 1]);
    let down: Vec<bool> = (0..vertex_count)
        .map(|v| {
            let ny = f64::from(normals[v * 3 + 1]);
            let length = hypot3([f64::from(normals[v * 3]), ny, f64::from(normals[v * 3 + 2])]);
            length > 0.0 && ny / length <= -0.3
        })
        .collect();
    let mut parent: Vec<usize> = (0..vertex_count).collect();
    fn root(parent: &mut [usize], mut v: usize) -> usize {
        while parent[v] != v {
            let grand = parent[parent[v]];
            parent[v] = grand;
            v = grand;
        }
        v
    }
    for v in 0..vertex_count {
        if !down[v] {
            continue;
        }
        for k in degree[v]..degree[v + 1] {
            let w = neighbours[k as usize] as usize;
            if down[w] && (y(w) - y(v)).abs() <= epsilon {
                let (rw, rv) = (root(&mut parent, w), root(&mut parent, v));
                parent[rw] = rv;
            }
        }
    }
    // A plateau is a lowest point when none of its vertices has a lower neighbour; it is an island
    // when no contact lies within one Support spacing of any of its vertices.
    struct Plateau {
        lower: bool,
        covered: bool,
        sum: V3,
        count: usize,
    }
    let mut plateaus: Vec<Plateau> = Vec::new();
    let mut slot: HashMap<usize, usize> = HashMap::new();
    for v in 0..vertex_count {
        if !down[v] {
            continue;
        }
        let key = root(&mut parent, v);
        let k = *slot.entry(key).or_insert_with(|| {
            plateaus.push(Plateau { lower: false, covered: false, sum: [0.0; 3], count: 0 });
            plateaus.len() - 1
        });
        let point = [f64::from(positions[v * 3]), y(v), f64::from(positions[v * 3 + 2])];
        let plateau = &mut plateaus[k];
        let mut n = degree[v];
        while n < degree[v + 1] && !plateau.lower {
            if y(neighbours[n as usize] as usize) < point[1] - epsilon {
                plateau.lower = true;
            }
            n += 1;
        }
        if !plateau.covered && !plateau.lower && covered(point, spacing) {
            plateau.covered = true;
        }
        plateau.sum = [plateau.sum[0] + point[0], plateau.sum[1] + point[1], plateau.sum[2] + point[2]];
        plateau.count += 1;
    }
    for plateau in &plateaus {
        if plateau.lower || plateau.covered {
            continue;
        }
        let c = plateau.count as f64;
        spots.push(Spot { kind: ProblemKind::Island, position: [plateau.sum[0] / c, plateau.sum[1] / c, plateau.sum[2] / c], area: 0.0 });
    }

    // Overhang coverage on a lattice of about (spacing / 2)² per sample.
    let limit = (face_overhang_limit(settings.overhang_angle_degrees) * std::f64::consts::PI / 180.0).cos();
    let mut overhang_area = 0.0;
    for t in indices.chunks_exact(3) {
        let n = face_normal(positions, t[0], t[1], t[2]);
        let area = hypot3(n) / 2.0;
        if area > 0.0 && -n[1] / (2.0 * area) >= limit {
            overhang_area += area;
        }
    }
    let cell = (spacing / 2.0).powi(2).max(overhang_area / MAX_SAMPLES);
    for t in indices.chunks_exact(3) {
        let (a, b, c) = (t[0], t[1], t[2]);
        let n = face_normal(positions, a, b, c);
        let area = hypot3(n) / 2.0;
        if area == 0.0 || -n[1] / (2.0 * area) < limit {
            continue;
        }
        let steps = ((area / cell).sqrt().ceil() as usize).max(1);
        let share = area / (steps * steps) as f64;
        for i in 0..steps {
            for j in 0..steps - i {
                // Centres of the small triangles of a steps x steps subdivision (upright ones).
                let u = (i as f64 + 1.0 / 3.0) / steps as f64;
                let w = (j as f64 + 1.0 / 3.0) / steps as f64;
                let point = barycentric(positions, a, b, c, u, w);
                if !covered(point, spacing * COVER_FACTOR) {
                    spots.push(Spot { kind: ProblemKind::Overhang, position: point, area: share * 2.0 });
                }
            }
        }
    }

    // Spots in touching cells (2 x spacing) form one problem: one cleared patch is one entry.
    let size = spacing * 2.0;
    let key_of = |p: V3| ((p[0] / size).floor() as i64, (p[1] / size).floor() as i64, (p[2] / size).floor() as i64);
    let mut order: Vec<(i64, i64, i64)> = Vec::new();
    let mut cells: HashMap<(i64, i64, i64), Vec<usize>> = HashMap::new();
    for (index, spot) in spots.iter().enumerate() {
        let key = key_of(spot.position);
        cells.entry(key).or_insert_with(|| {
            order.push(key);
            Vec::new()
        }).push(index);
    }
    let mut seen: std::collections::HashSet<(i64, i64, i64)> = std::collections::HashSet::new();
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for &start in &order {
        if !seen.insert(start) {
            continue;
        }
        let mut group = Vec::new();
        let mut stack = vec![start];
        while let Some(key) = stack.pop() {
            group.extend_from_slice(&cells[&key]);
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for dz in -1..=1 {
                        let next = (key.0 + dx, key.1 + dy, key.2 + dz);
                        if cells.contains_key(&next) && seen.insert(next) {
                            stack.push(next);
                        }
                    }
                }
            }
        }
        groups.push(group);
    }
    let mut problems: Vec<SupportProblem> = groups
        .iter()
        .map(|group| {
            let members: Vec<&Spot> = group.iter().map(|&i| &spots[i]).collect();
            let island = members.iter().find(|s| s.kind == ProblemKind::Island);
            let area: f64 = members.iter().fold(0.0, |sum, s| sum + s.area);
            let mut centre = [0.0; 3];
            for s in &members {
                centre = [centre[0] + s.position[0], centre[1] + s.position[1], centre[2] + s.position[2]];
            }
            let n = members.len() as f64;
            let centre = [centre[0] / n, centre[1] / n, centre[2] / n];
            // Mark an island where it is, an overhang at its spot nearest the middle (on the surface).
            let dist = |p: V3| hypot3([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]);
            let anchor = match island {
                Some(s) => s,
                None => members.iter().skip(1).fold(members[0], |best, s| if dist(s.position) < dist(best.position) { s } else { best }),
            };
            SupportProblem { kind: if island.is_some() { ProblemKind::Island } else { ProblemKind::Overhang }, position: anchor.position, area }
        })
        .filter(|p| p.kind == ProblemKind::Island || p.area >= spacing * spacing / 4.0)
        .collect();
    problems.sort_by(|p, q| match (p.kind, q.kind) {
        (a, b) if a == b => q.area.partial_cmp(&p.area).unwrap_or(std::cmp::Ordering::Equal),
        (ProblemKind::Island, _) => std::cmp::Ordering::Less,
        _ => std::cmp::Ordering::Greater,
    });
    problems.truncate(MAX_PROBLEMS);
    problems
}

#[cfg(test)]
mod tests;
