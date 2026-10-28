//! SLASG_Raft perimeter (port of TS `raftOutline`). Blender flattens the model, builds a narrow-band
//! SDF with voxel size (3D bbox diagonal + 2 Expand) / Voxel Resolution, offsets it by Expand and
//! meshes it at iso 0.1 (dual contouring); the outline is the ring of dual vertices in the voxel
//! layer z in [0, v], resampled to 3 x Voxel Resolution points. Parts set apart on the plate each
//! get their own loop (`others`). Plan coordinates are web (x, z).

use super::plan::{P2, area, inside, resample_closed};
use super::raft_field::{PlanDistance, Tri, trace_contours};
use crate::core::jsnum::hypot;
use crate::core::vec::V3;
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct RaftLoop {
    /// Raw dual-contour loop (x, height above the plate, z), counter-clockwise from the start vertex.
    pub raw: Vec<V3>,
    /// The raft n-gon: clockwise resample, 3 x Voxel Resolution points.
    pub polygon: Vec<P2>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct RaftOutline {
    pub main: RaftLoop,
    pub others: Vec<RaftLoop>,
}

impl Default for RaftLoop {
    fn default() -> Self {
        Self { raw: Vec::new(), polygon: Vec::new() }
    }
}

struct Mesh<'a> {
    positions: &'a [f32],
    indices: &'a [u32],
}

impl Mesh<'_> {
    fn point(&self, index: u32) -> [f64; 3] {
        let o = index as usize * 3;
        [f64::from(self.positions[o]), f64::from(self.positions[o + 1]), f64::from(self.positions[o + 2])]
    }
}

pub fn raft_outline(positions: &[f32], indices: &[u32], expand: f64, voxel_resolution: usize) -> RaftOutline {
    let model = Mesh { positions, indices };
    // Parts set apart on one plate each get their own raft. The parts come from the mesh itself
    // (connected pieces whose footprints, grown by Expand Width, touch), never from the coarse trace.
    let fine = (expand / 2.0).max(0.25);
    let groups = part_groups(&model, expand);
    if groups.len() <= 1 {
        let whole = trace_outline(&model, expand, voxel_resolution, f64::INFINITY);
        return if whole.others.is_empty() { whole } else { trace_outline(&model, expand, voxel_resolution, fine) };
    }
    let traced: Vec<RaftOutline> = groups
        .iter()
        .map(|triangles| {
            let (p, i) = sub_mesh(&model, triangles);
            trace_outline(&Mesh { positions: &p, indices: &i }, expand, voxel_resolution, fine)
        })
        .filter(|outline| outline.main.polygon.len() >= 3)
        .collect();
    if traced.is_empty() {
        return RaftOutline::default();
    }
    let sizes: Vec<f64> = traced.iter().map(|o| area(&o.main.polygon).abs()).collect();
    let mut first = 0;
    for (k, size) in sizes.iter().enumerate() {
        if *size > sizes[first] {
            first = k;
        }
    }
    let mut others = Vec::new();
    for (k, outline) in traced.iter().enumerate() {
        if k != first {
            others.push(outline.main.clone());
        }
        others.extend(outline.others.iter().cloned());
    }
    RaftOutline { main: traced[first].main.clone(), others }
}

fn trace_outline(model: &Mesh, expand: f64, voxel_resolution: usize, max_voxel: f64) -> RaftOutline {
    let triangles = project_triangles(model);
    if triangles.is_empty() {
        return RaftOutline::default();
    }
    let (mut min, mut max) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for v in 0..model.positions.len() / 3 {
        let p = [f64::from(model.positions[v * 3]), f64::from(model.positions[v * 3 + 1]), f64::from(model.positions[v * 3 + 2])];
        for axis in 0..3 {
            min[axis] = min[axis].min(p[axis]);
            max[axis] = max[axis].max(p[axis]);
        }
    }
    let diagonal = hypot(&[max[0] - min[0], max[1] - min[1], max[2] - min[2]]);
    let voxel = ((diagonal + 2.0 * expand) / voxel_resolution as f64).min(max_voxel);
    let iso = expand + 0.1;
    let mut field = PlanDistance::new(&triangles, iso + 2.0 * voxel);

    let i0 = ((min[0] - iso) / voxel).floor() as i64 - 2;
    let i1 = ((max[0] + iso) / voxel).ceil() as i64 + 2;
    let j0 = ((min[2] - iso) / voxel).floor() as i64 - 2;
    let j1 = ((max[2] + iso) / voxel).ceil() as i64 + 2;
    let width = (i1 - i0 + 1) as usize;
    let height = (j1 - j0 + 1) as usize;
    let mut f0 = vec![0.0; width * height];
    let mut f1 = vec![0.0; width * height];
    for j in 0..height {
        for i in 0..width {
            let d = field.distance((i0 + i as i64) as f64 * voxel, (j0 + j as i64) as f64 * voxel);
            f0[j * width + i] = d - iso;
            f1[j * width + i] = hypot(&[d, voxel]) - iso;
        }
    }

    let node = |i: usize, j: usize| -> P2 { [(i0 + i as i64) as f64 * voxel, (j0 + j as i64) as f64 * voxel] };
    let at = |grid: &[f64], i: usize, j: usize| grid[j * width + i];
    // Dual vertex (x, height, z): mean of the iso crossings on the cell's twelve edges.
    let dual3 = |i: usize, j: usize| -> V3 {
        let (mut sx, mut sy, mut sz, mut n) = (0.0, 0.0, 0.0, 0.0);
        let corners = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)];
        for (grid, h) in [(&f0, 0.0), (&f1, voxel)] {
            for k in 0..4 {
                let (ai, aj) = corners[k];
                let (bi, bj) = corners[(k + 1) % 4];
                let (a, b) = (at(grid, ai, aj), at(grid, bi, bj));
                if (a < 0.0) == (b < 0.0) {
                    continue;
                }
                let t = a / (a - b);
                let (pa, pb) = (node(ai, aj), node(bi, bj));
                sx += pa[0] + (pb[0] - pa[0]) * t;
                sy += h;
                sz += pa[1] + (pb[1] - pa[1]) * t;
                n += 1.0;
            }
        }
        for (ci, cj) in corners {
            let (a, b) = (at(&f0, ci, cj), at(&f1, ci, cj));
            if (a < 0.0) == (b < 0.0) {
                continue;
            }
            let p = node(ci, cj);
            sx += p[0];
            sy += voxel * (a / (a - b));
            sz += p[1];
            n += 1.0;
        }
        if n == 0.0 {
            let p = node(i, j);
            return [p[0], 0.0, p[1]];
        }
        [sx / n, sy / n, sz / n]
    };
    let dual = |i: usize, j: usize| -> P2 {
        let p = dual3(i, j);
        [p[0], p[2]]
    };

    let loops = trace_contours(&f0, width, height);
    if loops.is_empty() {
        return RaftOutline::default();
    }
    let plans: Vec<Vec<P2>> = loops.iter().map(|l| l.iter().map(|&(i, j)| dual(i, j)).collect()).collect();
    let sizes: Vec<f64> = plans.iter().map(|p| area(p).abs()).collect();
    let mut largest = 0;
    for (k, size) in sizes.iter().enumerate() {
        if *size > sizes[largest] {
            largest = k;
        }
    }
    // OpenVDB emits points leaf by leaf (8^3 blocks in x, y, z order), x-major inside a leaf, so the
    // perimeter curve starts at the loop vertex with the smallest such key (Blender X/Y).
    let key = |(i, j): (usize, usize)| -> [i64; 4] {
        let x = i0 + i as i64;
        let y = -(j0 + j as i64 + 1);
        [x.div_euclid(8), y.div_euclid(8), ((x % 8) + 8) % 8, ((y % 8) + 8) % 8]
    };
    let build = |cells: &[(usize, usize)], samples: usize| -> RaftLoop {
        let mut start = 0;
        for (index, cell) in cells.iter().enumerate() {
            if key(*cell) < key(cells[start]) {
                start = index;
            }
        }
        let mut ordered: Vec<(usize, usize)> = cells[start..].iter().chain(cells[..start].iter()).copied().collect();
        let flipped: Vec<P2> = ordered.iter().map(|&(i, j)| dual(i, j)).map(|[x, z]| [x, -z]).collect();
        if area(&flipped) > 0.0 {
            let rest: Vec<(usize, usize)> = ordered[1..].iter().rev().copied().collect();
            ordered = std::iter::once(ordered[0]).chain(rest).collect();
        }
        let clockwise: Vec<V3> = ordered.iter().map(|&(i, j)| dual3(i, j)).collect();
        // The perimeter curve itself runs counter-clockwise from the start vertex (Roof/Cage columns
        // follow it); Fill Curve reverses the corners, so the raft n-gon is the clockwise resample.
        let raw: Vec<V3> = std::iter::once(clockwise[0]).chain(clockwise[1..].iter().rev().copied()).collect();
        let plan: Vec<P2> = clockwise.iter().map(|p| [p[0], p[2]]).collect();
        RaftLoop { raw, polygon: resample_closed(&plan, samples) }
    };
    let main = build(&loops[largest], 3 * voxel_resolution);
    let others = (0..plans.len())
        .filter(|&index| {
            index != largest && !plans.iter().enumerate().any(|(other, plan)| other != index && sizes[other] > sizes[index] && inside(plans[index][0], plan))
        })
        .map(|index| build(&loops[index], 3 * voxel_resolution))
        .collect();
    RaftOutline { main, others }
}

/// Triangles grouped into parts: connected pieces of the mesh, merged while their plan bounding
/// boxes, grown by Expand Width, overlap (their rafts would touch).
fn part_groups(model: &Mesh, expand: f64) -> Vec<Vec<usize>> {
    let count = model.indices.len() / 3;
    let mut parent: Vec<usize> = (0..model.positions.len() / 3).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for t in 0..count {
        for k in 1..3 {
            let (ra, rb) = (find(&mut parent, model.indices[t * 3] as usize), find(&mut parent, model.indices[t * 3 + k] as usize));
            if ra != rb {
                parent[ra] = rb;
            }
        }
    }
    struct Piece {
        bounds: [f64; 4],
        triangles: Vec<usize>,
    }
    let mut order: Vec<Piece> = Vec::new();
    let mut by_root: HashMap<usize, usize> = HashMap::new();
    for t in 0..count {
        let root = find(&mut parent, model.indices[t * 3] as usize);
        let slot = *by_root.entry(root).or_insert_with(|| {
            order.push(Piece { bounds: [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], triangles: Vec::new() });
            order.len() - 1
        });
        let piece = &mut order[slot];
        piece.triangles.push(t);
        for k in 0..3 {
            let v = model.point(model.indices[t * 3 + k]);
            piece.bounds[0] = piece.bounds[0].min(v[0]);
            piece.bounds[1] = piece.bounds[1].min(v[2]);
            piece.bounds[2] = piece.bounds[2].max(v[0]);
            piece.bounds[3] = piece.bounds[3].max(v[2]);
        }
    }
    order.sort_by(|a, b| a.bounds[0].total_cmp(&b.bounds[0]));
    let mut group: Vec<usize> = (0..order.len()).collect();
    fn top(group: &mut [usize], mut i: usize) -> usize {
        while group[i] != i {
            group[i] = group[group[i]];
            i = group[i];
        }
        i
    }
    let reach = 2.0 * expand + 0.2;
    for i in 0..order.len() {
        let mut j = i + 1;
        while j < order.len() && order[j].bounds[0] <= order[i].bounds[2] + reach {
            let (a, b) = (order[i].bounds, order[j].bounds);
            if b[1] <= a[3] + reach && a[1] <= b[3] + reach {
                let (ti, tj) = (top(&mut group, i), top(&mut group, j));
                group[ti] = tj;
            }
            j += 1;
        }
    }
    let mut merged: Vec<(usize, Vec<usize>)> = Vec::new();
    let mut slot_of: HashMap<usize, usize> = HashMap::new();
    for (i, piece) in order.iter().enumerate() {
        let key = top(&mut group, i);
        match slot_of.get(&key) {
            Some(&slot) => merged[slot].1.extend(piece.triangles.iter().copied()),
            None => {
                slot_of.insert(key, merged.len());
                merged.push((key, piece.triangles.clone()));
            }
        }
    }
    merged.into_iter().map(|(_, triangles)| triangles).collect()
}

/// The given triangles as their own mesh, vertices compacted so their own bounding box is used.
fn sub_mesh(model: &Mesh, triangles: &[usize]) -> (Vec<f32>, Vec<u32>) {
    let mut remap: HashMap<u32, u32> = HashMap::new();
    let mut positions = Vec::new();
    let mut indices = Vec::with_capacity(triangles.len() * 3);
    for &t in triangles {
        for k in 0..3 {
            let index = model.indices[t * 3 + k];
            let mapped = *remap.entry(index).or_insert_with(|| {
                positions.extend_from_slice(&model.positions[index as usize * 3..index as usize * 3 + 3]);
                (positions.len() / 3 - 1) as u32
            });
            indices.push(mapped);
        }
    }
    (positions, indices)
}

fn project_triangles(model: &Mesh) -> Vec<Tri> {
    (0..model.indices.len() / 3)
        .map(|face| {
            let p = |k: usize| {
                let v = model.point(model.indices[face * 3 + k]);
                [v[0], v[2]]
            };
            [p(0), p(1), p(2)]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A flat 10 x 10 mm square plate model at height 0..1.
    fn square() -> (Vec<f32>, Vec<u32>) {
        let p = vec![0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 10.0, 0.0, 10.0, 0.0, 0.0, 10.0, 0.0, 1.0, 0.0, 10.0, 1.0, 0.0, 10.0, 1.0, 10.0, 0.0, 1.0, 10.0];
        (p, vec![0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6])
    }

    #[test]
    fn square_outline_surrounds_the_model_by_about_expand() {
        let (p, i) = square();
        let outline = raft_outline(&p, &i, 3.0, 64);
        assert_eq!(outline.main.polygon.len(), 192);
        assert!(outline.others.is_empty());
        let xs: Vec<f64> = outline.main.polygon.iter().map(|q| q[0]).collect();
        let (lo, hi) = (xs.iter().copied().fold(f64::INFINITY, f64::min), xs.iter().copied().fold(f64::NEG_INFINITY, f64::max));
        assert!((lo + 3.0).abs() < 0.6 && (hi - 13.0).abs() < 0.6, "{lo} {hi}");
    }

    #[test]
    fn two_far_parts_get_separate_loops() {
        let (mut p, mut i) = square();
        let n = (p.len() / 3) as u32;
        let (q, j) = square();
        p.extend(q.iter().enumerate().map(|(k, v)| if k % 3 == 0 { v + 60.0 } else { *v }));
        i.extend(j.iter().map(|v| v + n));
        let outline = raft_outline(&p, &i, 3.0, 64);
        assert_eq!(outline.others.len(), 1);
    }
}
