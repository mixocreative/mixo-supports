//! Contact-ring coverage. A ring is a closed contour that wants a support
//! contact at about every `spacing` (dental: the outer and the opening rim; thresholds are profile
//! data). A ring with a gap is a review trigger, never a clinical acceptance threshold.

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
