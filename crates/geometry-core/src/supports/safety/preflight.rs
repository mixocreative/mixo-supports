//! Cheap route screening before a column is built (ports of TS `pathPreflight.ts`,
//! `columnPathScreen.ts`, `candidateSelection.ts`). Only the finished mesh can prove final safety;
//! `generate` does not use these (SHIP-PLAN U7: route preflight stays out of the production path
//! until a collision-heavy fixture shows a measured benefit with zero false-safe results).

use super::index::CollisionIndex;
use super::tri::segment_triangle_hit;
use crate::core::vec::V3;
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq)]
pub enum PathPreflight {
    Clear,
    Blocked { model_face: u32 },
    Inconclusive { reason: &'static str },
}

#[derive(Default)]
pub struct PreflightOptions<'a> {
    pub contact_face: Option<u32>,
    /// Starting contact span to defer to the exact built-mesh classifier, in millimetres.
    pub uncertain_start_mm: Option<f64>,
    /// Ending contact span to defer to the exact built-mesh classifier, in millimetres.
    pub uncertain_end_mm: Option<f64>,
    pub cancelled: Option<&'a dyn Fn() -> bool>,
}

impl PreflightOptions<'_> {
    fn is_cancelled(&self) -> bool {
        self.cancelled.is_some_and(|f| f())
    }
}

fn bad_span(v: Option<f64>) -> bool {
    v.is_some_and(|v| !v.is_finite() || v < 0.0)
}

pub fn preflight_support_path(index: &CollisionIndex, points: &[V3], radius_mm: f64, options: &PreflightOptions) -> PathPreflight {
    use PathPreflight::{Blocked, Clear, Inconclusive};
    if options.is_cancelled() {
        return Inconclusive { reason: "cancelled" };
    }
    if !index.valid
        || !index.cell_mm.is_finite()
        || index.cell_mm <= 0.0
        || !radius_mm.is_finite()
        || radius_mm < 0.0
        || points.len() < 2
        || bad_span(options.uncertain_start_mm)
        || bad_span(options.uncertain_end_mm)
        || options.contact_face.is_some_and(|f| f as usize >= index.face_bounds.len())
        || points.iter().any(|p| p.iter().any(|c| !c.is_finite()))
    {
        return Inconclusive { reason: "invalid-geometry" };
    }
    let cell = index.cell_mm;
    let mut near_face = false;
    let mut contact_face = false;
    let mut travelled = 0.0;
    let seg_len = |a: V3, b: V3| crate::core::jsnum::hypot3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    let total: f64 = points.windows(2).map(|w| seg_len(w[0], w[1])).sum();
    for segment in 0..points.len() - 1 {
        if options.is_cancelled() {
            return Inconclusive { reason: "cancelled" };
        }
        let (from, to) = (points[segment], points[segment + 1]);
        let segment_mm = seg_len(from, to);
        let lo = |axis: usize| from[axis].min(to[axis]) - radius_mm;
        let hi = |axis: usize| from[axis].max(to[axis]) + radius_mm;
        let (x0, x1) = ((lo(0) / cell).floor() as i64, (hi(0) / cell).floor() as i64);
        let (z0, z1) = ((lo(2) / cell).floor() as i64, (hi(2) / cell).floor() as i64);
        if (x1 - x0 + 1) * (z1 - z0 + 1) > 4096 {
            return Inconclusive { reason: "query-budget" };
        }
        let mut seen: HashSet<u32> = HashSet::new();
        let mut checked = 0;
        for x in x0..=x1 {
            for z in z0..=z1 {
                if options.is_cancelled() {
                    return Inconclusive { reason: "cancelled" };
                }
                for &face in index.cell(x, z) {
                    if !seen.insert(face) {
                        continue;
                    }
                    checked += 1;
                    if checked > 100_000 {
                        return Inconclusive { reason: "query-budget" };
                    }
                    let b = &index.face_bounds[face as usize];
                    if (0..3).any(|axis| b.max[axis] < lo(axis) || b.min[axis] > hi(axis)) {
                        continue;
                    }
                    if options.contact_face == Some(face) {
                        contact_face = true;
                        continue;
                    }
                    if let Some(hit) = segment_triangle_hit(from, to, &index.triangle(face as usize)) {
                        let at = travelled + hit * segment_mm;
                        if options.uncertain_start_mm.is_some_and(|s| at <= s) || options.uncertain_end_mm.is_some_and(|e| total - at <= e) {
                            contact_face = true;
                            continue;
                        }
                        return Blocked { model_face: face };
                    }
                    near_face = true;
                }
            }
        }
        travelled += segment_mm;
    }
    if near_face {
        return Inconclusive { reason: "radius-envelope" };
    }
    if contact_face {
        return Inconclusive { reason: "contact-reach" };
    }
    Clear
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoutePart {
    Neck,
    Pillar,
    Foot,
    TreeBranch,
    TreeTrunk,
    Brace,
}

/// Proposed tube centre-line in the builder's plate-space millimetre frame.
#[derive(Clone, Debug)]
pub struct SupportRoute {
    pub part: RoutePart,
    pub points: Vec<V3>,
    /// Conservative maximum radius along the route; the final mesh still needs exact testing.
    pub radius_mm: f64,
    /// Printed secondary-contact reach to defer to exact classification, measured back from the end.
    pub uncertain_end_mm: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ColumnScreen {
    Blocked { part: RoutePart, model_face: u32 },
    Defer { reason: &'static str },
}

/// Finds only definite shaft/foot centre-line crossings; every other case needs exact built-mesh review.
pub fn screen_column_routes(index: &CollisionIndex, routes: &[SupportRoute], cancelled: Option<&dyn Fn() -> bool>) -> ColumnScreen {
    if cancelled.is_some_and(|f| f()) {
        return ColumnScreen::Defer { reason: "cancelled" };
    }
    let mut uncertain = "exact-contact-check";
    let mut checked = false;
    for route in routes {
        // Contact necks are intentionally embedded in the source surface and need face-local classification.
        if route.part != RoutePart::Pillar && route.part != RoutePart::Foot {
            continue;
        }
        checked = true;
        let options = PreflightOptions { uncertain_end_mm: route.uncertain_end_mm, cancelled, ..Default::default() };
        match preflight_support_path(index, &route.points, route.radius_mm, &options) {
            PathPreflight::Blocked { model_face } => return ColumnScreen::Blocked { part: route.part, model_face },
            PathPreflight::Inconclusive { reason } => {
                if matches!(reason, "cancelled" | "invalid-geometry" | "query-budget") {
                    return ColumnScreen::Defer { reason };
                }
                uncertain = reason;
            }
            PathPreflight::Clear => {}
        }
    }
    ColumnScreen::Defer { reason: if checked { uncertain } else { "no-shaft-route" } }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CandidateOrigin {
    Auto,
    Manual,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CandidateChoice<T> {
    Provisional { candidate: T, screen: PathPreflight, checked: u32 },
    Manual { candidate: T, screen: PathPreflight, checked: u32 },
    Unresolved { reason: &'static str, checked: u32 },
}

/// Deterministic bounded trial order; `Provisional` always requires exact final-mesh review. A
/// manual candidate is returned as is, never moved or dropped.
pub fn choose_candidate<T: Clone>(
    original: &T,
    alternatives: &[T],
    origin: CandidateOrigin,
    max_candidates: u32,
    permitted: &dyn Fn(&T) -> bool,
    preflight: &mut dyn FnMut(&T) -> PathPreflight,
) -> CandidateChoice<T> {
    if max_candidates < 1 {
        return CandidateChoice::Unresolved { reason: "invalid-budget", checked: 0 };
    }
    if origin == CandidateOrigin::Manual {
        let screen = preflight(original);
        return CandidateChoice::Manual { candidate: original.clone(), screen, checked: 1 };
    }
    let total = alternatives.len() as u32 + 1;
    let mut checked = 0;
    for at in 0..total.min(max_candidates) {
        let candidate = if at == 0 { original } else { &alternatives[at as usize - 1] };
        if !permitted(candidate) {
            continue;
        }
        let screen = preflight(candidate);
        checked += 1;
        if let PathPreflight::Inconclusive { reason } = &screen {
            if matches!(*reason, "cancelled" | "invalid-geometry" | "query-budget") {
                return CandidateChoice::Unresolved { reason, checked };
            }
        }
        if !matches!(screen, PathPreflight::Blocked { .. }) {
            return CandidateChoice::Provisional { candidate: candidate.clone(), screen, checked };
        }
    }
    CandidateChoice::Unresolved { reason: if total > max_candidates { "candidate-budget" } else { "all-blocked" }, checked }
}

#[cfg(test)]
mod tests {
    use super::*;
    use PathPreflight::{Blocked, Clear, Inconclusive};

    fn shelf(y: &[f32]) -> (Vec<f32>, Vec<u32>) {
        let mut positions = Vec::new();
        let mut indices = Vec::new();
        for (k, &h) in y.iter().enumerate() {
            positions.extend([-2.0, h, -2.0, 2.0, h, -2.0, 0.0, h, 2.0]);
            indices.extend([k as u32 * 3, k as u32 * 3 + 1, k as u32 * 3 + 2]);
        }
        (positions, indices)
    }

    #[test]
    fn preflight_cases() {
        let (p, i) = shelf(&[5.0]);
        let index = CollisionIndex::new(&p, &i);
        let none = PreflightOptions::default();
        assert_eq!(preflight_support_path(&index, &[[8.0, 0.0, 0.0], [8.0, 10.0, 0.0]], 0.4, &none), Clear);
        assert_eq!(preflight_support_path(&index, &[[0.0, 0.0, 0.0], [0.0, 10.0, 0.0]], 0.4, &none), Blocked { model_face: 0 });
        assert!(matches!(preflight_support_path(&index, &[[-0.5, 5.3, 0.0], [0.5, 5.3, 0.0]], 0.4, &none), Inconclusive { .. }));
        let contact = PreflightOptions { contact_face: Some(0), ..Default::default() };
        assert_eq!(preflight_support_path(&index, &[[0.0, 0.0, 0.0], [0.0, 5.0, 0.0]], 0.4, &contact), Inconclusive { reason: "contact-reach" });
        let bad = PreflightOptions { contact_face: Some(99), ..Default::default() };
        assert!(matches!(preflight_support_path(&index, &[[8.0, 0.0, 0.0], [8.0, 10.0, 0.0]], 0.4, &bad), Inconclusive { .. }));
    }

    #[test]
    fn short_tip_adjacent_hit_is_uncertain_but_a_farther_wall_is_found() {
        let (p, i) = shelf(&[5.0]);
        let index = CollisionIndex::new(&p, &i);
        let path = [[0.0, 5.0, 0.0], [0.0, 0.0, 0.0]];
        let start = PreflightOptions { uncertain_start_mm: Some(0.6), ..Default::default() };
        assert_eq!(preflight_support_path(&index, &path, 0.4, &PreflightOptions::default()), Blocked { model_face: 0 });
        assert_eq!(preflight_support_path(&index, &path, 0.4, &start), Inconclusive { reason: "contact-reach" });
        let (p2, i2) = shelf(&[5.0, 2.0]);
        let two = CollisionIndex::new(&p2, &i2);
        assert_eq!(preflight_support_path(&two, &path, 0.4, &start), Blocked { model_face: 1 });
    }

    #[test]
    fn an_intended_end_contact_does_not_hide_an_earlier_wall() {
        let (p, i) = shelf(&[5.0]);
        let index = CollisionIndex::new(&p, &i);
        let path = [[0.0, 0.0, 0.0], [0.0, 5.0, 0.0]];
        let end = PreflightOptions { uncertain_end_mm: Some(0.6), ..Default::default() };
        assert_eq!(preflight_support_path(&index, &path, 0.4, &end), Inconclusive { reason: "contact-reach" });
        let (p2, i2) = shelf(&[2.0, 5.0]);
        assert_eq!(preflight_support_path(&CollisionIndex::new(&p2, &i2), &path, 0.4, &end), Blocked { model_face: 0 });
    }

    #[test]
    fn abstains_on_malformed_input_and_cancellation() {
        let (p, i) = shelf(&[5.0]);
        let index = CollisionIndex::new(&p, &i);
        let none = PreflightOptions::default();
        assert!(matches!(preflight_support_path(&index, &[[0.0; 3], [f64::NAN, 8.0, 0.0]], 0.4, &none), Inconclusive { .. }));
        assert!(matches!(preflight_support_path(&index, &[[0.0; 3], [0.0, 8.0, 0.0]], -1.0, &none), Inconclusive { .. }));
        assert!(matches!(preflight_support_path(&index, &[[0.0; 3]], 0.4, &none), Inconclusive { .. }));
        let always = || true;
        let cancelled = PreflightOptions { cancelled: Some(&always), ..Default::default() };
        assert_eq!(preflight_support_path(&index, &[[8.0, 0.0, 0.0], [8.0, 10.0, 0.0]], 0.4, &cancelled), Inconclusive { reason: "cancelled" });
        let bad = CollisionIndex::new(&[0.0, 0.0, 0.0], &[0, 1, 2]);
        assert!(matches!(preflight_support_path(&bad, &[[8.0, 0.0, 0.0], [8.0, 10.0, 0.0]], 0.4, &none), Inconclusive { .. }));
        let counter = std::cell::Cell::new(0);
        let third = || {
            counter.set(counter.get() + 1);
            counter.get() >= 3
        };
        let mid = PreflightOptions { cancelled: Some(&third), ..Default::default() };
        assert_eq!(preflight_support_path(&index, &[[0.0; 3], [0.0, 10.0, 0.0]], 0.4, &mid), Inconclusive { reason: "cancelled" });
    }

    fn route(part: RoutePart, points: &[V3], end: Option<f64>) -> SupportRoute {
        SupportRoute { part, points: points.to_vec(), radius_mm: 0.4, uncertain_end_mm: end }
    }

    #[test]
    fn column_screen_cases() {
        let p = [-3.0f32, 5.0, -3.0, 3.0, 5.0, -3.0, 0.0, 5.0, 3.0];
        let index = CollisionIndex::new(&p, &[0, 1, 2]);
        let crossing = [route(RoutePart::Neck, &[[0.0, 10.0, 0.0], [0.0, 8.0, 0.0]], None), route(RoutePart::Pillar, &[[0.0, 8.0, 0.0], [0.0; 3]], None)];
        assert_eq!(screen_column_routes(&index, &crossing, None), ColumnScreen::Blocked { part: RoutePart::Pillar, model_face: 0 });
        let neck_only = [route(RoutePart::Neck, &[[0.0, 8.0, 0.0], [0.0, 2.0, 0.0]], None), route(RoutePart::Pillar, &[[8.0, 8.0, 0.0], [8.0, 0.0, 0.0]], None)];
        assert!(matches!(screen_column_routes(&index, &neck_only, None), ColumnScreen::Defer { .. }));
        let landing = [route(RoutePart::Pillar, &[[0.0, 10.0, 0.0], [0.0, 4.8, 0.0]], Some(1.0))];
        assert_eq!(screen_column_routes(&index, &landing, None), ColumnScreen::Defer { reason: "contact-reach" });
        let p2 = [-3.0f32, 7.0, -3.0, 3.0, 7.0, -3.0, 0.0, 7.0, 3.0, -3.0, 5.0, -3.0, 3.0, 5.0, -3.0, 0.0, 5.0, 3.0];
        let two = CollisionIndex::new(&p2, &[0, 1, 2, 3, 4, 5]);
        assert_eq!(screen_column_routes(&two, &landing, None), ColumnScreen::Blocked { part: RoutePart::Pillar, model_face: 0 });
        let envelope = [route(RoutePart::Pillar, &[[-0.5, 5.3, 0.0], [0.5, 5.3, 0.0]], None)];
        assert!(matches!(screen_column_routes(&index, &envelope, None), ColumnScreen::Defer { .. }));
        let always = || true;
        let straight = [route(RoutePart::Pillar, &[[0.0, 8.0, 0.0], [0.0; 3]], None)];
        assert_eq!(screen_column_routes(&index, &straight, Some(&always)), ColumnScreen::Defer { reason: "cancelled" });
    }

    #[test]
    fn candidate_selection_cases() {
        let blocked = Blocked { model_face: 4 };
        let mut visited: Vec<i32> = Vec::new();
        let mut run = |origin, max, permitted: &dyn Fn(&i32) -> bool, screen: &dyn Fn(i32) -> PathPreflight| {
            visited.clear();
            let mut visit = |v: &i32| {
                visited.push(*v);
                screen(*v)
            };
            let out = choose_candidate(&0, &[1, 2], origin, max, permitted, &mut visit);
            (out, visited.clone())
        };
        let (out, seen) = run(CandidateOrigin::Auto, 3, &|_| true, &|_| Clear);
        assert_eq!((out, seen), (CandidateChoice::Provisional { candidate: 0, screen: Clear, checked: 1 }, vec![0]));
        let (out, seen) = run(CandidateOrigin::Auto, 3, &|v| *v != 1, &|v| if v == 0 { Blocked { model_face: 4 } } else { Clear });
        assert_eq!((out, seen), (CandidateChoice::Provisional { candidate: 2, screen: Clear, checked: 2 }, vec![0, 2]));
        let (out, seen) = run(CandidateOrigin::Manual, 3, &|_| false, &|_| Blocked { model_face: 4 });
        assert_eq!((out, seen), (CandidateChoice::Manual { candidate: 0, screen: blocked.clone(), checked: 1 }, vec![0]));
        let near = Inconclusive { reason: "radius-envelope" };
        let (out, seen) = run(CandidateOrigin::Auto, 2, &|_| true, &|_| near.clone());
        assert_eq!((out, seen), (CandidateChoice::Provisional { candidate: 0, screen: near, checked: 1 }, vec![0]));
        let (out, seen) = run(CandidateOrigin::Auto, 2, &|_| true, &|_| Blocked { model_face: 4 });
        assert_eq!((out, seen), (CandidateChoice::Unresolved { reason: "candidate-budget", checked: 2 }, vec![0, 1]));
        let (out, _) = run(CandidateOrigin::Auto, 2, &|_| true, &|_| Inconclusive { reason: "cancelled" });
        assert_eq!(out, CandidateChoice::Unresolved { reason: "cancelled", checked: 1 });
    }
}
