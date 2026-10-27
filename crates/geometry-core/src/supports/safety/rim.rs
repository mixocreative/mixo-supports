//! Contact-ring coverage and gap-repair options. A ring is a closed contour that wants a support
//! contact at about every `spacing` (dental: the outer and the opening rim; thresholds are profile
//! data). Ports of TS `dentalRimCoverage.ts` and `dentalGapAlternates.ts`: a ring with a gap is a
//! review trigger, never a clinical acceptance threshold, and an alternate only proposes a contact
//! (it does not authorise a support body: the exact safety checks still decide).

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RingCoverage {
    pub perimeter_mm: f64,
    pub retained: u32,
    pub max_gap_mm: f64,
    /// Twice the intended spacing.
    pub review_gap_mm: f64,
    pub needs_review: bool,
}

/// Largest arclength without a built contact, including the wraparound seam.
pub fn largest_circular_gap(perimeter: f64, positions: &[f64]) -> Result<f64, &'static str> {
    if !perimeter.is_finite() || perimeter <= 0.0 {
        return Err("Contour perimeter must be positive");
    }
    if positions.iter().any(|p| !p.is_finite() || *p < 0.0 || *p >= perimeter) {
        return Err("Contact arclength is outside contour perimeter");
    }
    if positions.is_empty() {
        return Ok(perimeter);
    }
    let mut ordered = positions.to_vec();
    ordered.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut largest = perimeter + ordered[0] - ordered[ordered.len() - 1];
    for pair in ordered.windows(2) {
        largest = largest.max(pair[1] - pair[0]);
    }
    Ok(largest)
}

/// Coverage of one ring from the arclengths of its retained (built) contacts.
pub fn ring_coverage(perimeter_mm: f64, spacing_mm: f64, retained_at: &[f64]) -> Result<RingCoverage, &'static str> {
    if !spacing_mm.is_finite() || spacing_mm <= 0.0 {
        return Err("Invalid ring measure");
    }
    let max_gap_mm = largest_circular_gap(perimeter_mm, retained_at)?;
    let review_gap_mm = spacing_mm * 2.0;
    Ok(RingCoverage { perimeter_mm, retained: retained_at.len() as u32, max_gap_mm, review_gap_mm, needs_review: max_gap_mm > review_gap_mm + 1e-6 })
}

/// An alternate contact on a ring: its arclength and source face.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArcContact {
    pub distance_along: f64,
    pub face: u32,
}

/// One alternate per oversized gap between retained contacts: the one nearest the gap midpoint.
pub fn select_gap_alternates(perimeter: f64, retained_at: &[f64], alternates: &[ArcContact], threshold: f64) -> Vec<ArcContact> {
    if !perimeter.is_finite() || perimeter <= 0.0 || !threshold.is_finite() || threshold <= 0.0 || retained_at.is_empty() || retained_at.iter().any(|a| !a.is_finite() || *a < 0.0 || *a >= perimeter) {
        return Vec::new();
    }
    let mut retained = retained_at.to_vec();
    retained.sort_by(|a, b| a.partial_cmp(b).unwrap());
    retained.dedup();
    let candidates: Vec<&ArcContact> = alternates.iter().filter(|c| c.distance_along.is_finite() && c.distance_along >= 0.0 && c.distance_along < perimeter).collect();
    let mut chosen = Vec::new();
    for index in 0..retained.len() {
        let from = retained[index];
        let to = if index == retained.len() - 1 { retained[0] + perimeter } else { retained[index + 1] };
        let gap = to - from;
        if gap <= threshold {
            continue;
        }
        let midpoint = gap / 2.0;
        let mut within: Vec<(f64, &ArcContact)> = candidates
            .iter()
            .map(|c| ((c.distance_along - from + perimeter).rem_euclid(perimeter), *c))
            .filter(|(offset, _)| *offset > 1e-6 && *offset < gap - 1e-6)
            .collect();
        within.sort_by(|a, b| (a.0 - midpoint).abs().partial_cmp(&(b.0 - midpoint).abs()).unwrap().then(a.0.partial_cmp(&b.0).unwrap()).then(a.1.face.cmp(&b.1.face)));
        if let Some((_, best)) = within.first() {
            chosen.push(**best);
        }
    }
    chosen
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arc(at: f64, face: u32) -> ArcContact {
        ArcContact { distance_along: at, face }
    }
    fn faces(v: Vec<ArcContact>) -> Vec<u32> {
        v.into_iter().map(|c| c.face).collect()
    }

    #[test]
    fn measures_final_retained_gaps_across_the_seam_of_each_closed_ring() {
        let outer = ring_coverage(20.0, 3.0, &[1.0, 4.0, 7.0, 10.0, 13.0, 16.0, 19.0]).unwrap();
        assert_eq!((outer.max_gap_mm, outer.needs_review), (3.0, false));
        let opening = ring_coverage(20.0, 2.0, &[1.0, 3.0, 5.0, 15.0, 17.0, 19.0]).unwrap();
        assert_eq!((opening.max_gap_mm, opening.needs_review), (10.0, true));
    }

    #[test]
    fn an_entirely_unsupported_ring_is_flagged_not_complete() {
        let outer = ring_coverage(12.0, 3.0, &[]).unwrap();
        assert_eq!((outer.max_gap_mm, outer.needs_review, outer.retained), (12.0, true, 0));
        assert_eq!(ring_coverage(8.0, 2.0, &[]).unwrap().max_gap_mm, 8.0);
        assert!(ring_coverage(0.0, 2.0, &[]).is_err() && ring_coverage(8.0, 0.0, &[]).is_err() && ring_coverage(8.0, 2.0, &[9.0]).is_err());
    }

    #[test]
    fn one_midpoint_near_alternate_per_oversized_gap() {
        let options = [arc(3.0, 30), arc(5.0, 50), arc(7.0, 70), arc(11.0, 110), arc(13.0, 130), arc(15.0, 150), arc(19.0, 190)];
        assert_eq!(faces(select_gap_alternates(20.0, &[1.0, 9.0, 17.0], &options, 4.0)), vec![50, 130]);
    }

    #[test]
    fn handles_the_seam_and_never_selects_a_retained_position() {
        let options = [arc(1.0, 10), arc(3.0, 30), arc(17.0, 170), arc(19.0, 190)];
        assert_eq!(faces(select_gap_alternates(20.0, &[3.0, 17.0], &options, 5.0)), vec![190]);
    }

    #[test]
    fn no_repair_on_invalid_measurements_or_gaps_without_an_alternate() {
        assert!(select_gap_alternates(0.0, &[1.0], &[arc(2.0, 20)], 4.0).is_empty());
        assert!(select_gap_alternates(20.0, &[1.0, 9.0, 17.0], &[arc(1.0, 10)], 4.0).is_empty());
        assert!(select_gap_alternates(20.0, &[1.0, 9.0, 17.0], &[arc(f64::NAN, 10)], 4.0).is_empty());
    }
}
