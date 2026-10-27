//! Drag-over screen brush maths: support bodies reduced to axis segments, their projection to the
//! canvas, and which supports a circle swept along a stroke touches and can see. Framework-free:
//! the host hands in a local-to-clip matrix and the visible occluding models. Mirrors
//! src/editing/screenBrush.ts (the TS oracle), including its single-precision projected buffer.

use super::matrix::{Matrix4, apply_to_direction, apply_to_point};
use super::spatial::{Bvh, Side};

/// Model-in-front tolerance (mm): a tip sinks a little into the surface it touches.
pub const HIDE_TOLERANCE: f64 = 0.5;
const RING_BAND: f64 = 0.05;
/// Floats per projected segment: ax, ay, aw, bx, by, bw, t0, t1.
pub const PROJECTED_STRIDE: usize = 8;
const NEAR_W: f64 = 1e-2;
const SPOTS: usize = 3;
const SHORT_STRETCH: f64 = 6.0;
const CACHE_STEPS: f64 = 8.0;
/// "No contact" in a component's contact key.
pub const NO_CONTACT: u32 = u32::MAX;

/// Support bodies as axis segments: slot `i` owns segments `first[i]..first[i + 1]`, 6 floats each.
#[derive(Debug, Default, PartialEq)]
pub struct BodySegments {
    /// The caller's contact key of each slot, in order of first appearance.
    pub keys: Vec<u32>,
    pub first: Vec<u32>,
    pub points: Vec<f32>,
}

/// Each component with a contact reduced to its axis (top ring centre to bottom ring centre).
/// Component `k` covers `indices[start[k]..start[k] + count[k]]`.
pub fn body_segments(positions: &[f32], indices: &[u32], contact: &[u32], start: &[u32], count: &[u32]) -> BodySegments {
    let mut keys: Vec<u32> = Vec::new();
    let mut lists: Vec<Vec<f64>> = Vec::new();
    for k in 0..contact.len() {
        if contact[k] == NO_CONTACT || count[k] == 0 {
            continue;
        }
        let range = start[k] as usize..(start[k] + count[k]) as usize;
        let y_of = |i: usize| f64::from(positions[indices[i] as usize * 3 + 1]);
        let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
        for i in range.clone() {
            low = low.min(y_of(i));
            high = high.max(y_of(i));
        }
        let band = (1e-4f64).max((high - low) * RING_BAND);
        let (mut top, mut bottom) = ([0.0f64; 4], [0.0f64; 4]);
        for i in range {
            let v = indices[i] as usize * 3;
            let y = f64::from(positions[v + 1]);
            let ring = if y >= high - band { &mut top } else if y <= low + band { &mut bottom } else { continue };
            ring[0] += f64::from(positions[v]);
            ring[1] += y;
            ring[2] += f64::from(positions[v + 2]);
            ring[3] += 1.0;
        }
        let b = if bottom[3] > 0.0 { bottom } else { top };
        let slot = match keys.iter().position(|&key| key == contact[k]) {
            Some(slot) => slot,
            None => {
                keys.push(contact[k]);
                lists.push(Vec::new());
                keys.len() - 1
            }
        };
        lists[slot].extend_from_slice(&[top[0] / top[3], top[1] / top[3], top[2] / top[3], b[0] / b[3], b[1] / b[3], b[2] / b[3]]);
    }
    let mut first = Vec::with_capacity(keys.len() + 1);
    let mut points = Vec::new();
    let mut segments = 0u32;
    for list in &lists {
        first.push(segments);
        segments += (list.len() / 6) as u32;
        points.extend(list.iter().map(|&v| v as f32));
    }
    first.push(segments);
    BodySegments { keys, first, points }
}

/// Canvas pixel (y down) and clip w of a point; `None` behind the camera.
pub fn project_point(m: &Matrix4, p: [f64; 3], width: f64, height: f64) -> Option<[f64; 3]> {
    let w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if !(w > 1e-9) {
        return None;
    }
    let cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    let cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    Some([(cx / w + 1.0) * 0.5 * width, (1.0 - cy / w) * 0.5 * height, w])
}

/// Every body segment on the canvas (`PROJECTED_STRIDE` floats, single precision): ends in px with
/// clip w, and the 3D range [t0, t1] they stand for. A segment reaching behind the camera is cut
/// at the camera plane; one wholly behind it is NaN.
pub fn project_bodies(points: &[f32], m: &Matrix4, width: f64, height: f64) -> Vec<f32> {
    let count = points.len() / 6;
    let mut out = vec![f32::NAN; count * PROJECTED_STRIDE];
    let w_of = |p: [f64; 3]| m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    for segment in 0..count {
        let i = segment * 6;
        let a = [f64::from(points[i]), f64::from(points[i + 1]), f64::from(points[i + 2])];
        let b = [f64::from(points[i + 3]), f64::from(points[i + 4]), f64::from(points[i + 5])];
        let (wa, wb) = (w_of(a), w_of(b));
        let (mut t0, mut t1) = (0.0f64, 1.0f64);
        if !(wa > NEAR_W) && !(wb > NEAR_W) {
            continue;
        }
        if !(wa > NEAR_W) {
            t0 = (NEAR_W - wa) / (wb - wa);
        } else if !(wb > NEAR_W) {
            t1 = (NEAR_W - wa) / (wb - wa);
        }
        let lerp = |t: f64| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        let start = project_point(m, if t0 == 0.0 { a } else { lerp(t0) }, width, height);
        let end = project_point(m, if t1 == 1.0 { b } else { lerp(t1) }, width, height);
        let (Some(start), Some(end)) = (start, end) else { continue };
        let o = segment * PROJECTED_STRIDE;
        for (k, v) in [start[0], start[1], start[2], end[0], end[1], end[2], t0, t1].into_iter().enumerate() {
            out[o + k] = v as f32;
        }
    }
    out
}

/// Squared distance from (px, py) to segment ab and the parameter of its closest point.
fn to_segment(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> (f64, f64) {
    let (dx, dy) = (bx - ax, by - ay);
    let length2 = dx * dx + dy * dy;
    let s = if length2 > 0.0 { (((px - ax) * dx + (py - ay) * dy) / length2).clamp(0.0, 1.0) } else { 0.0 };
    let (ex, ey) = (ax + dx * s - px, ay + dy * s - py);
    (ex * ex + ey * ey, s)
}

/// Closest approach of screen segment ab to segment cd: squared distance and the parameter on ab.
pub fn closest_on_segments(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64, dx: f64, dy: f64) -> (f64, f64) {
    let (rx, ry, qx, qy) = (bx - ax, by - ay, dx - cx, dy - cy);
    let denominator = rx * qy - ry * qx;
    if denominator != 0.0 {
        let s = ((cx - ax) * qy - (cy - ay) * qx) / denominator;
        let u = ((cx - ax) * ry - (cy - ay) * rx) / denominator;
        if (0.0..=1.0).contains(&s) && (0.0..=1.0).contains(&u) {
            return (0.0, s);
        }
    }
    let mut best = to_segment(cx, cy, ax, ay, bx, by);
    let from_d = to_segment(dx, dy, ax, ay, bx, by);
    if from_d.0 < best.0 {
        best = from_d;
    }
    let from_a = to_segment(ax, ay, cx, cy, dx, dy).0;
    if from_a < best.0 {
        best = (from_a, 0.0);
    }
    let from_b = to_segment(bx, by, cx, cy, dx, dy).0;
    if from_b < best.0 {
        best = (from_b, 1.0);
    }
    best
}

/// The 3D parameter along a segment of the point at screen parameter `s` (perspective-correct).
pub fn perspective_param(s: f64, wa: f64, wb: f64) -> f64 {
    let denominator = (1.0 - s) * wb + s * wa;
    if denominator > 0.0 { (s * wa) / denominator } else { s }
}

/// A visible model that may hide a support: its pick index and the support-local to model-local matrix (rigid).
pub struct Occluder<'a> {
    pub positions: &'a [f32],
    pub indices: &'a [u32],
    pub bvh: &'a Bvh,
    pub to_local: Matrix4,
    pub side: Side,
}

/// Everything one stroke needs.
pub struct Stroke<'a> {
    /// Support-local to clip, including the object's world matrix.
    pub matrix: Matrix4,
    pub width: f64,
    pub height: f64,
    /// The camera position in support-local space.
    pub eye: [f64; 3],
    pub radius: f64,
    /// Pointer samples (x, y) in canvas px; the first is a lone circle, each next one sweeps from the previous.
    pub points: &'a [f64],
    /// Slots `start..end` are tested (a host slices a frame's work); `want[slot] == 0` skips a slot.
    pub start: usize,
    pub end: usize,
    pub want: Option<&'a [u8]>,
}

/// Slots of `bodies` whose support the brush touches along the stroke and can see (union over
/// the stroke's sweeps, ascending). Visibility is one ray per spot against the occluders,
/// remembered per part and spot (t quantised to 1/8) for the whole stroke.
pub fn project_brush(bodies: &BodySegments, occluders: &[Occluder], stroke: &Stroke) -> Vec<u32> {
    let projected = project_bodies(&bodies.points, &stroke.matrix, stroke.width, stroke.height);
    let end = stroke.end.min(bodies.keys.len());
    let mut hit = vec![false; bodies.keys.len()];
    let mut cache: std::collections::HashMap<u64, bool> = std::collections::HashMap::new();
    let mut previous: Option<[f64; 2]> = None;
    for sample in stroke.points.chunks_exact(2) {
        let to = [sample[0], sample[1]];
        sweep(bodies, &projected, previous, to, stroke, end, occluders, &mut cache, &mut hit);
        previous = Some(to);
    }
    (0..hit.len() as u32).filter(|&slot| hit[slot as usize]).collect()
}

fn ray_visible(point: [f64; 3], eye: [f64; 3], occluders: &[Occluder]) -> bool {
    let d = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
    let distance = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    if !(distance > 0.0) || occluders.is_empty() {
        return true;
    }
    let direction = [d[0] / distance, d[1] / distance, d[2] / distance];
    let mut nearest: Option<f64> = None;
    for occluder in occluders {
        let origin = apply_to_point(&occluder.to_local, eye[0], eye[1], eye[2]);
        let local = apply_to_direction(&occluder.to_local, direction[0], direction[1], direction[2]);
        let far = nearest.unwrap_or(distance);
        if let Some(h) = occluder.bvh.raycast_first(occluder.positions, occluder.indices, origin, local, 0.0, far, occluder.side) {
            if nearest.is_none_or(|n| h.distance < n) {
                nearest = Some(h.distance);
            }
        }
    }
    !nearest.is_some_and(|n| n < distance - HIDE_TOLERANCE)
}

#[allow(clippy::too_many_arguments)]
fn sweep(
    bodies: &BodySegments,
    projected: &[f32],
    from: Option<[f64; 2]>,
    to: [f64; 2],
    stroke: &Stroke,
    end: usize,
    occluders: &[Occluder],
    cache: &mut std::collections::HashMap<u64, bool>,
    hits: &mut [bool],
) {
    let [cx, cy] = from.unwrap_or(to);
    let [dx, dy] = to;
    let radius = stroke.radius;
    let limit = radius * radius;
    let (min_x, max_x) = (cx.min(dx) - radius, cx.max(dx) + radius);
    let (min_y, max_y) = (cy.min(dy) - radius, cy.max(dy) + radius);
    let p = |o: usize| f64::from(projected[o]);
    let visible_at = |segment: usize, s: f64, cache: &mut std::collections::HashMap<u64, bool>| {
        let o = segment * PROJECTED_STRIDE;
        let t0 = p(o + 6);
        let t = t0 + (p(o + 7) - t0) * perspective_param(s, p(o + 2), p(o + 5));
        let q = segment * 6;
        let pt = |k: usize| f64::from(bodies.points[q + k]);
        let sample = [pt(0) + (pt(3) - pt(0)) * t, pt(1) + (pt(4) - pt(1)) * t, pt(2) + (pt(5) - pt(2)) * t];
        let key = (segment as u64) * (CACHE_STEPS as u64 + 1) + (t.clamp(0.0, 1.0) * CACHE_STEPS).round() as u64;
        *cache.entry(key).or_insert_with(|| ray_visible(sample, stroke.eye, occluders))
    };
    let mut under: Vec<(usize, f64)> = Vec::new();
    for slot in stroke.start..end {
        if hits[slot] || stroke.want.is_some_and(|w| w.get(slot).copied().unwrap_or(0) == 0) {
            continue;
        }
        under.clear();
        for segment in bodies.first[slot] as usize..bodies.first[slot + 1] as usize {
            let o = segment * PROJECTED_STRIDE;
            let (ax, ay, bx, by) = (p(o), p(o + 1), p(o + 3), p(o + 4));
            // NaN (behind the camera) fails every comparison below.
            if !(ax.max(bx) >= min_x && ax.min(bx) <= max_x && ay.max(by) >= min_y && ay.min(by) <= max_y) {
                continue;
            }
            let (distance2, s) = closest_on_segments(ax, ay, bx, by, cx, cy, dx, dy);
            if distance2 <= limit {
                under.push((segment, s));
            }
        }
        if under.is_empty() {
            continue;
        }
        let mut hit = false;
        for &(segment, s) in &under {
            if visible_at(segment, s, cache) {
                hit = true;
                break;
            }
        }
        let mut k = 0;
        while k < under.len() && !hit {
            let (segment, middle) = under[k];
            k += 1;
            let o = segment * PROJECTED_STRIDE;
            let (ax, ay, bx, by) = (p(o), p(o + 1), p(o + 3), p(o + 4));
            let inside = |s: f64| to_segment(ax + (bx - ax) * s, ay + (by - ay) * s, cx, cy, dx, dy).0 <= limit;
            let edge = |mut inner: f64, mut outer: f64| {
                if inside(outer) {
                    return outer;
                }
                for _ in 0..10 {
                    let half = (inner + outer) / 2.0;
                    if inside(half) { inner = half } else { outer = half }
                }
                inner
            };
            let (s0, s1) = (edge(middle, 0.0), edge(middle, 1.0));
            if (bx - ax).hypot(by - ay) * (s1 - s0) < SHORT_STRETCH {
                continue;
            }
            for spot in 0..SPOTS {
                let s = s0 + ((s1 - s0) * spot as f64) / (SPOTS - 1) as f64;
                if (s - middle).abs() > 1e-6 && visible_at(segment, s, cache) {
                    hit = true;
                    break;
                }
            }
        }
        if hit {
            hits[slot] = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Orthographic-like clip matrix: x, y pass through scaled, w = 1 (looking down -Z).
    fn flat() -> Matrix4 {
        [0.1, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, -0.01, 0.0, 0.0, 0.0, 0.0, 1.0]
    }

    fn one_body(a: [f32; 3], b: [f32; 3]) -> BodySegments {
        BodySegments { keys: vec![7], first: vec![0, 1], points: [a, b].concat() }
    }

    #[test]
    fn circle_over_a_visible_body_hits_and_far_away_misses() {
        let bodies = one_body([0.0, 0.0, 0.0], [10.0, 0.0, 0.0]);
        let mk = |points: &'static [f64]| Stroke { matrix: flat(), width: 200.0, height: 200.0, eye: [0.0, 0.0, 50.0], radius: 8.0, points, start: 0, end: 1, want: None };
        // Body projects to x 100..200 at y 100.
        assert_eq!(project_brush(&bodies, &[], &mk(&[150.0, 104.0])), vec![0]);
        assert!(project_brush(&bodies, &[], &mk(&[150.0, 130.0])).is_empty());
        // A swept path from far away reaches it.
        assert_eq!(project_brush(&bodies, &[], &mk(&[150.0, 150.0, 150.0, 100.0])), vec![0]);
    }

    #[test]
    fn model_in_front_hides_the_body() {
        let bodies = one_body([0.0, 0.0, 0.0], [10.0, 0.0, 0.0]);
        // A big triangle at z = 20 (between eye z = 50 and the body at z = 0), facing +Z.
        let positions = [-100.0f32, -100.0, 20.0, 100.0, -100.0, 20.0, 0.0, 100.0, 20.0];
        let indices = [0u32, 1, 2];
        let bvh = Bvh::build(&positions, &indices);
        let identity = super::super::matrix::placement_matrix([0.0; 3], [0.0; 3]);
        let occluder = Occluder { positions: &positions, indices: &indices, bvh: &bvh, to_local: identity, side: Side::Double };
        let stroke = Stroke { matrix: flat(), width: 200.0, height: 200.0, eye: [0.0, 0.0, 50.0], radius: 8.0, points: &[150.0, 100.0], start: 0, end: 1, want: None };
        assert!(project_brush(&bodies, &[occluder], &stroke).is_empty());
        assert_eq!(project_brush(&bodies, &[], &stroke), vec![0]);
    }

    #[test]
    fn body_segments_reduce_a_part_to_its_axis_and_skip_contactless_parts() {
        // A column of two stacked triangles: top ring at y = 10, bottom ring at y = 0.
        let positions = [0.0f32, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 10.0, 0.0, 2.0, 10.0, 0.0];
        let indices = [0u32, 1, 2, 1, 3, 2];
        let b = body_segments(&positions, &indices, &[5, NO_CONTACT], &[0, 3], &[3, 3]);
        assert_eq!(b.keys, vec![5]);
        assert_eq!(b.first, vec![0, 1]);
        assert_eq!(b.points[1], 10.0);
        assert_eq!(b.points[4], 0.0);
    }

    #[test]
    fn segment_behind_the_camera_projects_to_nan() {
        let m: Matrix4 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0];
        let out = project_bodies(&[0.0, 0.0, -5.0, 1.0, 0.0, -6.0], &m, 100.0, 100.0);
        assert!(out.iter().all(|v| v.is_nan()));
    }
}
