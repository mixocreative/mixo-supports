//! Print-angle search (docs/ROADMAP.md, step F): scan the tilts the profile allows, judge each by
//! four hard rules on the real tip sampler's output, and pick the print angle. Each scanned pose is
//! the profile's target frame (`pose.rs`) with `tilt_deg` replaced; heading and roll stay fixed.
//! Detection and its distance field do not depend on the pose and are computed once (`cache`).
//! The rules are a cheap pre-build screen: built supports are still judged by the safety engine.

use super::footprint::{RimSide, Tuning, footprint_settings};
use super::mesh::{Mesh, MinHeap};
use super::orient::{Proposal, propose_orientation};
use super::policy::{candidate_id, contour_length};
use super::pose::{euler_to_pose, plate_up_in_mesh, source_frame};
use super::profiles::{AlignerProfile, Pose};
use super::region::{Region, propose_region_facing};
use crate::core::spatial::{Bvh, Side};
use crate::core::vec::{V3, add, cross, dot, normalize, scale, sub};
use crate::supports::safety::rings::ring_coverage;
use std::cmp::Ordering;

/// The four hard rules, in report order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rule {
    /// A lowest point outside the permitted area that holds resin (no support can reach it).
    Cup = 0,
    /// A rim gap at or above twice that rim's spacing.
    Gap = 1,
    /// A neck or the pillar below it runs into the aligner.
    Crossing = 2,
    /// A support too thin for its height.
    Slender = 3,
}

pub const RULES: [Rule; 4] = [Rule::Cup, Rule::Gap, Rule::Crossing, Rule::Slender];

/// What failed a rule first: a mesh vertex (cup) or a tip (candidate id).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failing {
    Vertex(u32),
    Tip(String),
}

/// One scanned tilt.
#[derive(Clone, Debug, PartialEq)]
pub struct TiltRow {
    pub tilt_deg: f64,
    /// Steps from the start tilt (negative: less tilt).
    pub step: i32,
    /// Euler XYZ (radians) turning the mesh into this pose.
    pub rotation: [f64; 3],
    /// Per rule (see [`RULES`]): the first failing vertex or tip, `None` when the rule passes.
    pub failing: [Option<Failing>; 4],
    pub fitting_side_tips: usize,
    pub largest_gap_mm: f64,
    pub largest_slenderness: f64,
    pub largest_layer_mm2: f64,
    pub height_mm: f64,
}

impl TiltRow {
    pub fn failed(&self, rule: Rule) -> bool {
        self.failing[rule as usize].is_some()
    }
    pub fn failed_count(&self) -> usize {
        self.failing.iter().filter(|f| f.is_some()).count()
    }
    pub fn passes(&self) -> bool {
        self.failed_count() == 0
    }
}

/// Why the pick was chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PickReason {
    /// It and both tilts at ± the margin pass every rule.
    Robust,
    /// No tilt is robust; it passes every rule.
    Passing,
    /// No tilt passes; it fails the fewest rules.
    Failing,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TiltScan {
    pub start_deg: f64,
    pub rows: Vec<TiltRow>,
    /// Row indices in pick order (the pick first; the confirm tries the next ones).
    pub order: Vec<usize>,
    pub reason: PickReason,
    /// First and last row index of the run of robust tilts containing the pick.
    pub band: Option<(usize, usize)>,
    pub robust: Vec<bool>,
}

impl TiltScan {
    pub fn pick(&self) -> &TiltRow {
        &self.rows[self.order[0]]
    }
}

/// The host's current support settings the rules need: neck length and pillar diameter (rule 3),
/// lift (the lowest point's height above the plate) and whether Tree or Brace is on (rule 4).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScanArgs {
    pub neck_length_mm: f64,
    pub pillar_diameter_mm: f64,
    pub lift_mm: f64,
    pub braced: bool,
}

/// The scanned tilts: start ± range in steps, start included (steps from the start).
pub fn scan_steps(pose: &Pose) -> Vec<i32> {
    let count = if pose.tilt_step_deg > 0.0 && pose.tilt_range_deg >= 0.0 { (pose.tilt_range_deg / pose.tilt_step_deg + 1e-9).floor() as i32 } else { 0 };
    (-count..=count).collect()
}

/// Per-vertex edge neighbours (pose independent).
pub struct Adjacency {
    offsets: Vec<u32>,
    neighbours: Vec<u32>,
}

impl Adjacency {
    pub fn of(mesh: &Mesh) -> Self {
        let vertices = mesh.vertex_count();
        let mut pairs: Vec<(u32, u32)> = Vec::with_capacity(mesh.indices.len() * 2);
        for face in mesh.indices.chunks_exact(3) {
            for k in 0..3 {
                let (a, b) = (face[k], face[(k + 1) % 3]);
                pairs.push((a, b));
                pairs.push((b, a));
            }
        }
        pairs.sort_unstable();
        pairs.dedup();
        let mut offsets = vec![0u32; vertices + 1];
        for &(a, _) in &pairs {
            offsets[a as usize + 1] += 1;
        }
        for at in 0..vertices {
            offsets[at + 1] += offsets[at];
        }
        Self { offsets, neighbours: pairs.into_iter().map(|(_, b)| b).collect() }
    }
    fn of_vertex(&self, vertex: u32) -> &[u32] {
        &self.neighbours[self.offsets[vertex as usize] as usize..self.offsets[vertex as usize + 1] as usize]
    }
}

/// Rule 1. The first vertex (lowest id) that is a local minimum along up (no edge neighbour lower),
/// lies outside the permitted area and whose prominence is at least `prominence_mm`. Prominence is
/// the smallest rise along up needed to reach, through mesh edges, a vertex lower than it (a global
/// minimum's is infinite).
pub fn first_cup(heights: &[f64], adjacency: &Adjacency, permitted_vertex: &[bool], prominence_mm: f64) -> Option<u32> {
    let mut seen: Vec<u32> = vec![u32::MAX; heights.len()];
    for vertex in 0..heights.len() as u32 {
        let h = heights[vertex as usize];
        if permitted_vertex[vertex as usize] || adjacency.of_vertex(vertex).iter().any(|&n| heights[n as usize] < h) {
            continue;
        }
        if prominence_at_least(vertex, heights, adjacency, prominence_mm, &mut seen) {
            return Some(vertex);
        }
    }
    None
}

/// Whether the vertex's prominence reaches `threshold`: a flood in rising height order that stops
/// at the first lower vertex (the rise so far is the prominence) or once the rise reaches it.
fn prominence_at_least(start: u32, heights: &[f64], adjacency: &Adjacency, threshold: f64, seen: &mut [u32]) -> bool {
    let base = heights[start as usize];
    let mut pending: MinHeap<u32> = MinHeap::new();
    pending.push(base, start);
    seen[start as usize] = start;
    let mut rise = 0.0f64;
    while let Some((h, vertex)) = pending.pop() {
        if h < base {
            return false;
        }
        rise = rise.max(h - base);
        if rise >= threshold {
            return true;
        }
        for &next in adjacency.of_vertex(vertex) {
            if seen[next as usize] != start {
                seen[next as usize] = start;
                pending.push(heights[next as usize], next);
            }
        }
    }
    // The whole connected piece was flooded without a lower vertex: a global minimum.
    let _ = rise;
    true
}

/// Rule 3 for one tip: the neck (from the tip along its face normal for `neck_mm`) and five rays
/// straight down from its end (centre, then four at `radius` 90 degrees apart, the first along
/// `axis`). A hit on the model is a crossing, except within 0.05 mm of a start or on the tip's own
/// source face.
pub fn tip_crosses(bvh: &Bvh, mesh: &Mesh, face: u32, position: V3, normal: V3, up: V3, axis: V3, neck_mm: f64, radius: f64) -> bool {
    const NEAR: f64 = 0.05;
    let hits = |origin: V3, direction: V3, far: f64| -> bool {
        let mut near = NEAR;
        while near <= far {
            match bvh.raycast_first(mesh.positions, mesh.indices, origin, direction, near, far, Side::Double) {
                Some(hit) if hit.face == face => near = hit.distance + 1e-9,
                Some(_) => return true,
                None => return false,
            }
        }
        false
    };
    if hits(position, normal, neck_mm) {
        return true;
    }
    let end = add(position, scale(normal, neck_mm));
    let down = scale(up, -1.0);
    let side = normalize(cross(up, axis));
    let starts = [end, add(end, scale(axis, radius)), add(end, scale(side, radius)), sub(end, scale(axis, radius)), sub(end, scale(side, radius))];
    starts.iter().any(|&start| hits(start, down, f64::INFINITY))
}

/// The largest layer: slices perpendicular to `up` every 1 mm from the lowest vertex, each slice's
/// area the sum of |signed area| of its polygons (the cut segments chained through the mesh edges
/// they cross), mm².
pub fn largest_layer(mesh: &Mesh, heights: &[f64], up: V3) -> f64 {
    let low = heights.iter().copied().fold(f64::INFINITY, f64::min);
    let high = heights.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if !(high > low) {
        return 0.0;
    }
    let slices = ((high - low).floor() as usize) + 1;
    // Per slice: (edge the cut enters, edge it leaves, start point, end point).
    let mut cuts: Vec<Vec<(u64, u64, V3, V3)>> = vec![Vec::new(); slices];
    let origin = mesh.point(0);
    let key = |a: u32, b: u32| (u64::from(a.min(b)) << 32) | u64::from(a.max(b));
    for face in mesh.indices.chunks_exact(3) {
        let h = [heights[face[0] as usize], heights[face[1] as usize], heights[face[2] as usize]];
        let (lo, hi) = (h[0].min(h[1]).min(h[2]), h[0].max(h[1]).max(h[2]));
        let first = ((lo - low).ceil().max(0.0)) as usize;
        if first >= slices || low + first as f64 > hi {
            continue;
        }
        let p = [sub(mesh.point(face[0]), origin), sub(mesh.point(face[1]), origin), sub(mesh.point(face[2]), origin)];
        let normal = cross(sub(p[1], p[0]), sub(p[2], p[0]));
        let mut slice = first;
        while slice < slices && low + slice as f64 <= hi {
            let level = low + slice as f64;
            let mut points: Vec<(u64, V3)> = Vec::with_capacity(2);
            for k in 0..3 {
                let (a, b) = (k, (k + 1) % 3);
                let (ha, hb) = (h[a] - level, h[b] - level);
                if (ha < 0.0) != (hb < 0.0) {
                    let t = ha / (ha - hb);
                    points.push((key(face[a], face[b]), add(p[a], scale(sub(p[b], p[a]), t))));
                }
            }
            if let [s, e] = points[..] {
                // Material lies against the face normal: orient the cut so the normal is on its right.
                let (s, e) = if dot(cross(sub(e.1, s.1), up), normal) >= 0.0 { (s, e) } else { (e, s) };
                cuts[slice].push((s.0, e.0, s.1, e.1));
            }
            slice += 1;
        }
    }
    cuts.into_iter().map(|segments| polygon_area_sum(&segments, up)).fold(0.0, f64::max)
}

/// Sum of |signed area| of the closed chains the segments make (an open chain counts as closed).
fn polygon_area_sum(segments: &[(u64, u64, V3, V3)], up: V3) -> f64 {
    let by_start: std::collections::HashMap<u64, usize> = segments.iter().enumerate().map(|(at, s)| (s.0, at)).collect();
    let mut used = vec![false; segments.len()];
    let mut total = 0.0;
    for first in 0..segments.len() {
        if used[first] {
            continue;
        }
        let mut signed = 0.0;
        let mut at = first;
        while !used[at] {
            used[at] = true;
            let (_, next, s, e) = segments[at];
            signed += 0.5 * dot(cross(s, e), up);
            match by_start.get(&next) {
                Some(&n) => at = n,
                None => break,
            }
        }
        total += f64::abs(signed);
    }
    total
}

/// Rule 2 for one rim: its largest gap between tips (mm) and whether it fails, exactly when the
/// ring check asks for a review (`RingCoverage::needs_review`: over twice the spacing).
pub fn rim_gap(perimeter_mm: f64, spacing_mm: f64, arcs: &[f64]) -> Result<(f64, bool), String> {
    let coverage = ring_coverage(perimeter_mm, spacing_mm, arcs).map_err(str::to_string)?;
    Ok((coverage.max_gap_mm, coverage.needs_review))
}

/// Rule 4's measure: a support's height above the plate per millimetre of pillar diameter.
pub fn slenderness(height_mm: f64, pillar_diameter_mm: f64) -> f64 {
    height_mm / pillar_diameter_mm
}

/// Pick order over the rows (see the module doc and docs/ROADMAP.md F): robust tilts, then
/// passing, then the rest by fewest failed rules; within each, fewest fitting-side tips, smallest
/// distance from the start, smallest largest layer, lowest print height, then the lower tilt.
pub fn pick_order(rows: &[TiltRow], margin_steps: i32) -> (Vec<usize>, Vec<bool>, PickReason) {
    let at = |step: i32| rows.iter().position(|r| r.step == step);
    let robust: Vec<bool> = rows
        .iter()
        .map(|r| r.passes() && [r.step - margin_steps, r.step + margin_steps].iter().all(|&s| at(s).is_some_and(|i| rows[i].passes())))
        .collect();
    let tier = |i: usize| if robust[i] { 0 } else if rows[i].passes() { 1 } else { 1 + rows[i].failed_count() };
    let mut order: Vec<usize> = (0..rows.len()).collect();
    order.sort_by(|&a, &b| {
        let (ra, rb) = (&rows[a], &rows[b]);
        tier(a)
            .cmp(&tier(b))
            .then(ra.fitting_side_tips.cmp(&rb.fitting_side_tips))
            .then(ra.step.abs().cmp(&rb.step.abs()))
            .then(ra.largest_layer_mm2.partial_cmp(&rb.largest_layer_mm2).unwrap_or(Ordering::Equal))
            .then(ra.height_mm.partial_cmp(&rb.height_mm).unwrap_or(Ordering::Equal))
            .then(ra.step.cmp(&rb.step))
    });
    let reason = match order.first() {
        Some(&i) if robust[i] => PickReason::Robust,
        Some(&i) if rows[i].passes() => PickReason::Passing,
        _ => PickReason::Failing,
    };
    (order, robust, reason)
}

/// The run of robust rows (rows are in step order) that contains `pick`.
pub fn stable_band(robust: &[bool], pick: usize) -> Option<(usize, usize)> {
    if !robust.get(pick).copied().unwrap_or(false) {
        return None;
    }
    let mut first = pick;
    while first > 0 && robust[first - 1] {
        first -= 1;
    }
    let mut last = pick;
    while last + 1 < robust.len() && robust[last + 1] {
        last += 1;
    }
    Some((first, last))
}

/// Everything about the mesh that no tilt changes.
pub struct Prepared<'a> {
    mesh: &'a Mesh<'a>,
    profile: &'a AlignerProfile,
    source: [V3; 3],
    opening: V3,
    adjacency: Adjacency,
    bvh: Bvh,
}

impl<'a> Prepared<'a> {
    /// `Err` is the reason the scan cannot run (orientation, arch front or detection).
    pub fn of(mesh: &'a Mesh<'a>, profile: &'a AlignerProfile) -> Result<Self, String> {
        let rim = match propose_orientation(mesh, profile) {
            Proposal::Proposal { rim, .. } => rim,
            Proposal::Inconclusive { reason, .. } => return Err(format!("orientation-{}", reason.code())),
        };
        let source = source_frame(mesh, &rim, &profile.thresholds).ok_or("ambiguous-arch-front")?;
        Ok(Self { mesh, profile, source, opening: rim.opening_direction, adjacency: Adjacency::of(mesh), bvh: Bvh::build(mesh.positions, mesh.indices) })
    }

    /// The pose at `step` steps from the start tilt.
    pub fn pose(&self, step: i32) -> Pose {
        let p = &self.profile.pose;
        Pose { tilt_deg: p.tilt_deg + f64::from(step) * p.tilt_step_deg, ..p.clone() }
    }

    /// One tilt: the sampler at its plate normal and the four rules.
    pub fn row(&self, step: i32, args: &ScanArgs) -> Result<TiltRow, String> {
        let (mesh, profile) = (self.mesh, self.profile);
        let pose = self.pose(step);
        let up = plate_up_in_mesh(&self.source, &pose);
        let tuning = Tuning::defaults(profile);
        let region = propose_region_facing(mesh, &tuning, profile, Some(up))?;
        let heights: Vec<f64> = (0..mesh.vertex_count() as u32).map(|v| dot(mesh.point(v), up)).collect();
        let low = heights.iter().copied().fold(f64::INFINITY, f64::min);
        let high = heights.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let ids = tip_ids(&region);
        let mut failing: [Option<Failing>; 4] = Default::default();
        // Rule 1: the permitted area is the strip plus the faces the tips moved to.
        let mut permitted_face: Vec<bool> = region.contact_faces.iter().map(|&f| f == 1).collect();
        for c in &region.contacts {
            permitted_face[c.contact.face as usize] = true;
        }
        let mut permitted_vertex = vec![false; mesh.vertex_count()];
        for (face, corners) in mesh.indices.chunks_exact(3).enumerate() {
            if permitted_face[face] {
                for &v in corners {
                    permitted_vertex[v as usize] = true;
                }
            }
        }
        failing[Rule::Cup as usize] = first_cup(&heights, &self.adjacency, &permitted_vertex, profile.stability.cup_prominence_mm).map(Failing::Vertex);
        // Rule 2: per rim, the largest gap between tips along the contour.
        let settings = footprint_settings(&tuning, profile).map_err(|r| format!("contact-footprint-{r}"))?;
        let mut largest_gap = 0.0f64;
        for (rim, edges, spacing) in [(RimSide::Outer, &region.contours.outer_edges, settings.outer_spacing), (RimSide::Opening, &region.contours.opening_edges, settings.inner_spacing)] {
            let perimeter = contour_length(mesh, edges);
            let tips: Vec<(f64, &String)> = region.contacts.iter().zip(&ids).filter(|(c, _)| c.rim == rim).map(|(c, id)| (c.contact.distance_along_contour.min(perimeter * (1.0 - 1e-12)), id)).collect();
            let arcs: Vec<f64> = tips.iter().map(|t| t.0).collect();
            let (gap, fails) = rim_gap(perimeter, spacing, &arcs)?;
            largest_gap = largest_gap.max(gap);
            if fails && failing[Rule::Gap as usize].is_none() {
                failing[Rule::Gap as usize] = Some(Failing::Tip(gap_end(&tips, perimeter, rim)));
            }
        }
        // Rule 3: neck and pillar rays.
        let axis = normalize(cross(up, self.opening));
        let radius = args.pillar_diameter_mm / 2.0;
        failing[Rule::Crossing as usize] = region
            .contacts
            .iter()
            .zip(&ids)
            .find(|(c, _)| tip_crosses(&self.bvh, mesh, c.contact.face, c.contact.position, c.contact.normal, up, axis, args.neck_length_mm, radius))
            .map(|(_, id)| Failing::Tip(id.clone()));
        // Rule 4: tip height above the plate (the lowest point at the host's lift) per pillar diameter.
        let limit = if args.braced { profile.stability.max_slenderness_braced } else { profile.stability.max_slenderness_unbraced };
        let slender = |c: &super::footprint::Contact| slenderness(dot(c.contact.position, up) - low + args.lift_mm, args.pillar_diameter_mm);
        let largest_slenderness = region.contacts.iter().map(slender).fold(0.0, f64::max);
        failing[Rule::Slender as usize] = region.contacts.iter().zip(&ids).find(|(c, _)| slender(c) > limit).map(|(_, id)| Failing::Tip(id.clone()));
        Ok(TiltRow {
            tilt_deg: pose.tilt_deg,
            step,
            rotation: euler_to_pose(&self.source, &pose),
            failing,
            fitting_side_tips: region.contacts.iter().filter(|c| region.allowed_faces[c.contact.face as usize] == 1).count(),
            largest_gap_mm: largest_gap,
            largest_slenderness,
            largest_layer_mm2: largest_layer(mesh, &heights, up),
            height_mm: high - low,
        })
    }
}

/// Candidate ids of the region's tips (as `dental_policy` names them).
fn tip_ids(region: &Region) -> Vec<String> {
    let mut counters = [0usize; 2];
    region
        .contacts
        .iter()
        .map(|c| {
            let counter = &mut counters[usize::from(c.rim == RimSide::Opening)];
            let id = candidate_id(c.rim, *counter).0;
            *counter += 1;
            id
        })
        .collect()
}

/// The tip that ends the largest gap of a rim (the rim's first id when it has no tip).
fn gap_end(tips: &[(f64, &String)], perimeter: f64, rim: RimSide) -> String {
    let mut sorted: Vec<&(f64, &String)> = tips.iter().collect();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));
    let Some(first) = sorted.first() else { return candidate_id(rim, 0).0 };
    let mut best = (perimeter + first.0 - sorted[sorted.len() - 1].0, first.1);
    for pair in sorted.windows(2) {
        if pair[1].0 - pair[0].0 > best.0 {
            best = (pair[1].0 - pair[0].0, pair[1].1);
        }
    }
    best.1.clone()
}

/// The whole scan. `Err` is the reason it cannot run.
pub fn tilt_scan(mesh: &Mesh, profile: &AlignerProfile, args: &ScanArgs) -> Result<TiltScan, String> {
    tilt_scan_with(mesh, profile, args, |_, _| {})
}

/// [`tilt_scan`], calling `on_tilt(done, total)` after each scanned tilt.
pub fn tilt_scan_with(mesh: &Mesh, profile: &AlignerProfile, args: &ScanArgs, mut on_tilt: impl FnMut(usize, usize)) -> Result<TiltScan, String> {
    if !(args.neck_length_mm >= 0.0) || !args.neck_length_mm.is_finite() || !(args.pillar_diameter_mm > 0.0) || !args.pillar_diameter_mm.is_finite() || !(args.lift_mm >= 0.0) || !args.lift_mm.is_finite() {
        return Err("invalid-scan-input".into());
    }
    let prepared = Prepared::of(mesh, profile)?;
    let steps = scan_steps(&profile.pose);
    let mut rows = Vec::with_capacity(steps.len());
    for &step in &steps {
        rows.push(prepared.row(step, args)?);
        on_tilt(rows.len(), steps.len());
    }
    let p = &profile.pose;
    let margin_steps = if p.tilt_step_deg > 0.0 { (p.tilt_margin_deg / p.tilt_step_deg).round() as i32 } else { 0 };
    let (order, robust, reason) = pick_order(&rows, margin_steps);
    let band = stable_band(&robust, order[0]);
    Ok(TiltScan { start_deg: p.tilt_deg, rows, order, reason, band, robust })
}

#[cfg(test)]
#[path = "tilt_tests.rs"]
mod tests;
