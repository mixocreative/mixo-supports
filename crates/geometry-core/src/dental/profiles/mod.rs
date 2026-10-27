//! Aligner profiles: the data that parameterises dental detection (docs/SHIP-PLAN.md, Aligner
//! profiles). A profile is a JSON file in this folder, embedded at build time and shared with the
//! TypeScript host (`src/dental/alignerProfiles.ts` imports the same file for names, descriptions and
//! card art). Adding an aligner type means adding a file and listing it in `ALL`, not new pipeline code.

use std::collections::HashMap;
use std::sync::OnceLock;

const REFERENCE_ALIGNER: &str = include_str!("reference-aligner.json");
const ALL: &[&str] = &[REFERENCE_ALIGNER];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpeningExpected {
    Yes,
    No,
    Either,
}

/// Detector thresholds (what counts as an aligner, a ridge, a hole, a region).
#[derive(Clone, Debug, PartialEq)]
pub struct Thresholds {
    pub axial_variance_max: f64,
    pub terminal_area_ratio_min: f64,
    pub terminal_band_fraction: f64,
    pub confidence_min: f64,
    pub sharp_angle_deg: f64,
    pub loop_min_vertices: usize,
    pub loop_band_fraction: f64,
    pub loop_band_min_mm: f64,
    pub loop_radius_ratio_min: f64,
    pub loop_extent_min: f64,
    pub ridge_first_min_edges: usize,
    pub ridge_second_min_edges: usize,
    pub ridge_extent_min: f64,
    pub connector_angle_deg: f64,
    pub opening_resolution_low: usize,
    pub opening_resolution_high: usize,
    pub opening_hole_min_fraction: f64,
    pub opening_loop_min_edges: usize,
    pub region_allowed_mean_min: f64,
    pub region_forbidden_mean_max: f64,
    pub region_allowed_fraction_min: f64,
    pub region_allowed_fraction_max: f64,
}

/// Default strip width, density and setback, their operator limits, and the contact spacing.
#[derive(Clone, Debug, PartialEq)]
pub struct Defaults {
    pub setback_mm: f64,
    pub strip_width_mm: f64,
    pub density: f64,
    pub setback_max_mm: f64,
    pub strip_width_min_mm: f64,
    pub strip_width_max_mm: f64,
    pub density_min: f64,
    pub density_max: f64,
    pub outer_spacing_mm: f64,
    pub inner_spacing_mm: f64,
    pub max_search_mm: f64,
    pub repair_budget: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AlignerProfile {
    pub id: String,
    pub opening: OpeningExpected,
    pub fixture: String,
    pub thresholds: Thresholds,
    pub defaults: Defaults,
}

fn value_after<'a>(source: &'a str, key: &str) -> &'a str {
    let pattern = format!("\"{key}\"");
    let at = source.find(&pattern).unwrap_or_else(|| panic!("profile key {key} missing"));
    source[at + pattern.len()..].trim_start().trim_start_matches(':').trim_start()
}

/// Value of the first `"key": <number>` in the profile JSON (numeric keys are unique per file).
fn number(source: &str, key: &str) -> f64 {
    let rest = value_after(source, key);
    let end = rest.find(|c: char| !(c.is_ascii_digit() || "-+.eE".contains(c))).unwrap_or(rest.len());
    rest[..end].parse().unwrap_or_else(|_| panic!("profile key {key} is not a number"))
}

fn string(source: &str, key: &str) -> String {
    let rest = value_after(source, key).strip_prefix('"').expect("string value");
    rest[..rest.find('"').expect("closing quote")].to_string()
}

fn parse(source: &str) -> AlignerProfile {
    let n = |key: &str| number(source, key);
    let opening = match string(source, "opening").as_str() {
        "yes" => OpeningExpected::Yes,
        "no" => OpeningExpected::No,
        "either" => OpeningExpected::Either,
        other => panic!("unknown opening expectation {other}"),
    };
    AlignerProfile {
        id: string(source, "id"),
        opening,
        fixture: string(source, "fixture"),
        thresholds: Thresholds {
            axial_variance_max: n("axialVarianceMax"),
            terminal_area_ratio_min: n("terminalAreaRatioMin"),
            terminal_band_fraction: n("terminalBandFraction"),
            confidence_min: n("confidenceMin"),
            sharp_angle_deg: n("sharpAngleDeg"),
            loop_min_vertices: n("loopMinVertices") as usize,
            loop_band_fraction: n("loopBandFraction"),
            loop_band_min_mm: n("loopBandMinMm"),
            loop_radius_ratio_min: n("loopRadiusRatioMin"),
            loop_extent_min: n("loopExtentMin"),
            ridge_first_min_edges: n("ridgeFirstMinEdges") as usize,
            ridge_second_min_edges: n("ridgeSecondMinEdges") as usize,
            ridge_extent_min: n("ridgeExtentMin"),
            connector_angle_deg: n("connectorAngleDeg"),
            opening_resolution_low: n("openingResolutionLow") as usize,
            opening_resolution_high: n("openingResolutionHigh") as usize,
            opening_hole_min_fraction: n("openingHoleMinFraction"),
            opening_loop_min_edges: n("openingLoopMinEdges") as usize,
            region_allowed_mean_min: n("regionAllowedMeanMin"),
            region_forbidden_mean_max: n("regionForbiddenMeanMax"),
            region_allowed_fraction_min: n("regionAllowedFractionMin"),
            region_allowed_fraction_max: n("regionAllowedFractionMax"),
        },
        defaults: Defaults {
            setback_mm: n("setbackMm"),
            strip_width_mm: n("stripWidthMm"),
            density: n("density"),
            setback_max_mm: n("setbackMaxMm"),
            strip_width_min_mm: n("stripWidthMinMm"),
            strip_width_max_mm: n("stripWidthMaxMm"),
            density_min: n("densityMin"),
            density_max: n("densityMax"),
            outer_spacing_mm: n("outerSpacingMm"),
            inner_spacing_mm: n("innerSpacingMm"),
            max_search_mm: n("maxSearchMm"),
            repair_budget: n("repairBudget") as u32,
        },
    }
}

fn registry() -> &'static HashMap<String, AlignerProfile> {
    static REGISTRY: OnceLock<HashMap<String, AlignerProfile>> = OnceLock::new();
    REGISTRY.get_or_init(|| ALL.iter().map(|source| parse(source)).map(|profile| (profile.id.clone(), profile)).collect())
}

/// The profile with this id, if one exists.
pub fn profile(id: &str) -> Option<&'static AlignerProfile> {
    registry().get(id)
}

/// Profile #1: the reference aligner (central opening expected).
pub fn reference_aligner() -> &'static AlignerProfile {
    profile("reference-aligner").expect("reference-aligner profile is embedded")
}

/// Ids of every embedded profile, sorted.
pub fn profile_ids() -> Vec<String> {
    let mut ids: Vec<String> = registry().keys().cloned().collect();
    ids.sort();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_profile_carries_the_pinned_thresholds_and_defaults() {
        let profile = reference_aligner();
        assert_eq!(profile.opening, OpeningExpected::Yes);
        assert_eq!(profile.fixture, "docs/dental-reference/reference-aligner.stl");
        assert_eq!(profile.thresholds.axial_variance_max, 0.6);
        assert_eq!(profile.thresholds.ridge_first_min_edges, 500);
        assert_eq!(profile.thresholds.region_forbidden_mean_max, -0.15);
        assert_eq!((profile.defaults.setback_mm, profile.defaults.strip_width_mm, profile.defaults.density), (0.2, 1.0, 1.0));
        assert_eq!((profile.defaults.outer_spacing_mm, profile.defaults.inner_spacing_mm, profile.defaults.max_search_mm), (3.0, 2.0, 1.5));
    }

    #[test]
    fn unknown_profile_is_none() {
        assert!(profile("nope").is_none());
        assert_eq!(profile_ids(), vec!["reference-aligner".to_string()]);
    }
}
