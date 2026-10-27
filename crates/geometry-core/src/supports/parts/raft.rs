//! SLASG_Raft solids from the resampled perimeter (port of TS `addRaft`): a floor whose edge flares
//! outward by Floor x tan(Wall Angle), an inset band of Wall Thickness, and wall runs raised to Wall
//! Height (leaning outward the same way). Blender raises the band quads whose face index
//! (N + 1 + k) mod 3 is at most 1, so every third segment stays a gap for resin drainage.
//! Also the footprint-only outline used without a model: the convex hull of the column feet grown by
//! Expand Width, resampled by rays from its mean.

use super::builder::MeshBuilder;
use super::plan::{P2, corner_bisectors};
use super::tags::{Part, Tag};
use super::vec::V3;
use crate::supports::settings::SupportSettings;

/// Resampled points of a raft outline built from the feet alone (no model).
const RING_SAMPLES: usize = 48;

fn ring(polygon: &[P2], bisectors: &[P2], amount: f64, y: f64) -> Vec<V3> {
    polygon.iter().enumerate().map(|(i, p)| [p[0] + bisectors[i][0] * amount, y, p[1] + bisectors[i][1] * amount]).collect()
}

pub fn emit_raft(builder: &mut MeshBuilder, polygon: &[P2], s: &SupportSettings) {
    // Corner order is kept as given: Blender numbers the rim band (and its gaps) from it.
    let slope = (s.raft_wall_angle * std::f64::consts::PI / 180.0).tan();
    let bisectors = corner_bisectors(polygon);
    let shifted = |amount: f64, y: f64| ring(polygon, &bisectors, amount, y);
    let floor = s.raft_floor_thickness;
    builder.begin(Tag::new(Part::Raft));
    builder.prism(&shifted(0.0, 0.0), &shifted(-floor * slope, floor));
    builder.end();
    if s.raft_wall_height <= floor || s.raft_wall_thickness <= 0.0 {
        return;
    }
    let lean = -(s.raft_wall_height - floor) * slope;
    let outer_bottom = shifted(-floor * slope, floor);
    let inner_bottom = shifted(-floor * slope + s.raft_wall_thickness, floor);
    let outer_top = shifted(-floor * slope + lean, s.raft_wall_height);
    let inner_top = shifted(-floor * slope + s.raft_wall_thickness + lean, s.raft_wall_height);
    let n = polygon.len();
    let raised = |k: usize| (n + 1 + k) % 3 <= 1;
    let mut start = 0;
    while start < n && raised(start) {
        start += 1;
    }
    for offset in 0..n {
        let k = (start + offset) % n;
        if !raised(k) || (offset > 0 && raised((k + n - 1) % n)) {
            continue;
        }
        let mut run = vec![k];
        while raised((run[run.len() - 1] + 1) % n) && run.len() < n {
            run.push((run[run.len() - 1] + 1) % n);
        }
        let mut corners = run.clone();
        corners.push((run[run.len() - 1] + 1) % n);
        let pick = |line: &[V3]| -> Vec<V3> { corners.iter().map(|&c| line[c]).collect() };
        builder.begin(Tag::new(Part::Raft));
        builder.strip(&pick(&outer_bottom), &pick(&inner_bottom), &pick(&outer_top), &pick(&inner_top));
        builder.end();
    }
}

/// Raft vertices MIXO_Label can anchor to: bottom ring, flared floor top and rim tops.
pub fn label_candidates(polygon: &[P2], s: &SupportSettings) -> Vec<V3> {
    let bisectors = corner_bisectors(polygon);
    let slope = (s.raft_wall_angle * std::f64::consts::PI / 180.0).tan();
    let mut out = ring(polygon, &bisectors, 0.0, 0.0);
    out.extend(ring(polygon, &bisectors, -s.raft_floor_thickness * slope, s.raft_floor_thickness));
    if s.raft_wall_height > s.raft_floor_thickness {
        out.extend(ring(polygon, &bisectors, -s.raft_wall_height * slope, s.raft_wall_height));
    }
    out
}

/// Raft outline without a model: convex hull of the feet grown by Expand Width.
pub fn footprint_ring(footprints: &[P2], expand: f64) -> Vec<P2> {
    if footprints.is_empty() {
        return Vec::new();
    }
    let sum = footprints.iter().fold([0.0, 0.0], |t, p| [t[0] + p[0], t[1] + p[1]]);
    let centre = [sum[0] / footprints.len() as f64, sum[1] / footprints.len() as f64];
    sample_ring(&dilated_hull(footprints, expand.max(0.05)), centre, RING_SAMPLES)
}

/// Convex hull of the points grown by `radius` (approximated with 16-gon discs).
fn dilated_hull(points: &[P2], radius: f64) -> Vec<P2> {
    let mut grown = Vec::new();
    for [x, z] in convex_hull(points) {
        for step in 0..16 {
            let angle = (step as f64 / 16.0) * std::f64::consts::PI * 2.0;
            grown.push([x + angle.cos() * radius, z + angle.sin() * radius]);
        }
    }
    convex_hull(&grown)
}

/// Samples a convex polygon by rays from `center` at evenly spaced angles, so rings loft vertex to vertex.
fn sample_ring(hull: &[P2], center: P2, count: usize) -> Vec<P2> {
    (0..count)
        .map(|step| {
            let angle = (step as f64 / count as f64) * std::f64::consts::PI * 2.0;
            let direction = [angle.cos(), angle.sin()];
            let mut reach = 0.0_f64;
            for (index, start) in hull.iter().enumerate() {
                let end = hull[(index + 1) % hull.len()];
                let edge = [end[0] - start[0], end[1] - start[1]];
                let denominator = direction[0] * edge[1] - direction[1] * edge[0];
                if denominator.abs() < 1e-12 {
                    continue;
                }
                let offset = [start[0] - center[0], start[1] - center[1]];
                let t = (offset[0] * edge[1] - offset[1] * edge[0]) / denominator;
                let u = (offset[0] * direction[1] - offset[1] * direction[0]) / denominator;
                if t > reach && u >= -1e-9 && u <= 1.0 + 1e-9 {
                    reach = t;
                }
            }
            [center[0] + direction[0] * reach, center[1] + direction[1] * reach]
        })
        .collect()
}

fn convex_hull(points: &[P2]) -> Vec<P2> {
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    if sorted.len() < 3 {
        return sorted;
    }
    let turn = |o: P2, a: P2, b: P2| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let chain = |input: &mut dyn Iterator<Item = P2>| -> Vec<P2> {
        let mut out: Vec<P2> = Vec::new();
        for point in input {
            while out.len() >= 2 && turn(out[out.len() - 2], out[out.len() - 1], point) <= 0.0 {
                out.pop();
            }
            out.push(point);
        }
        out
    };
    let lower = chain(&mut sorted.iter().copied());
    let upper = chain(&mut sorted.iter().rev().copied());
    let mut hull: Vec<P2> = lower[..lower.len() - 1].to_vec();
    hull.extend_from_slice(&upper[..upper.len() - 1]);
    hull
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::settings::default_values;

    #[test]
    fn footprint_ring_surrounds_the_feet() {
        let ring = footprint_ring(&[[0.0, 0.0], [10.0, 0.0], [5.0, 8.0]], 2.0);
        assert_eq!(ring.len(), RING_SAMPLES);
        assert!(ring.iter().all(|p| p[0] > -2.1 && p[0] < 12.1));
    }

    #[test]
    fn raft_emits_a_floor_and_rim_runs() {
        let s = SupportSettings::from_slice(&default_values()).unwrap();
        let polygon: Vec<P2> = (0..30).map(|k| { let a = f64::from(k) / 30.0 * std::f64::consts::TAU; [20.0 * a.cos(), 20.0 * a.sin()] }).collect();
        let mut builder = MeshBuilder::new();
        emit_raft(&mut builder, &polygon, &s);
        let mesh = builder.finish();
        assert!(mesh.components.len() > 1);
        assert!(mesh.components.iter().all(|c| c.tag.part == Part::Raft));
    }
}
