//! Aligner profiles: the data that parameterises dental detection (docs/SHIP-PLAN.md, Aligner
//! profiles). A profile is a JSON file in this folder, embedded at build time (`build.rs` lists the
//! folder) and shared with the TypeScript host (`src/dental/alignerProfiles.ts` reads the same files
//! for names, descriptions and card art). Adding an aligner type means adding one file, not new
//! pipeline code. Parsing is strict: an unknown or a missing key is an error.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

include!(concat!(env!("OUT_DIR"), "/profiles.rs"));

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpeningExpected {
    Yes,
    No,
    Either,
}

/// Detector thresholds (what counts as an aligner, a ridge, a hole, a region).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

/// Default strip width, density and setback, their operator limits, the contact spacing, the
/// repair budget, and how close a built contact must reproduce a candidate.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    /// A built automatic contact reproduces a candidate within this distance (mm) ...
    pub match_tolerance_mm: f64,
    /// ... and with normals at least this aligned (dot product).
    pub match_min_dot: f64,
}

/// Host text per locale (the profile card).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Localized {
    pub en: String,
    pub ja: String,
    #[serde(rename = "zh-Hant")]
    pub zh_hant: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignerProfile {
    pub id: String,
    pub name: Localized,
    pub description: Localized,
    pub opening: OpeningExpected,
    /// Card line art (SVG path data); the host draws it, the geometry ignores it.
    pub card: Vec<String>,
    pub fixture: String,
    pub thresholds: Thresholds,
    pub defaults: Defaults,
}

/// Parses one profile file strictly (unknown or missing keys are errors).
pub fn parse(source: &str) -> Result<AlignerProfile, String> {
    serde_json::from_str(source).map_err(|e| e.to_string())
}

fn registry() -> &'static HashMap<String, AlignerProfile> {
    static REGISTRY: OnceLock<HashMap<String, AlignerProfile>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        ALL.iter()
            .map(|(file, source)| parse(source).unwrap_or_else(|e| panic!("aligner profile {file}: {e}")))
            .map(|profile| (profile.id.clone(), profile))
            .collect()
    })
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
        assert_eq!((profile.defaults.match_tolerance_mm, profile.defaults.match_min_dot), (0.03, 0.95));
        assert_eq!(profile.name.zh_hant, "標準牙套");
    }

    /// Every profile file in the folder (and the test-only fixture) parses strictly.
    #[test]
    fn every_profile_file_parses_strictly() {
        assert!(!ALL.is_empty());
        for (file, source) in ALL {
            let profile = parse(source).unwrap_or_else(|e| panic!("{file}: {e}"));
            assert_eq!(format!("{}.json", profile.id), *file, "a profile file is named after its id");
        }
        parse(include_str!("testdata/second-aligner.json")).expect("test fixture parses");
    }

    #[test]
    fn an_unknown_or_a_missing_key_is_an_error() {
        let source = ALL[0].1;
        let unknown = source.replacen("\"repairBudget\"", "\"repairBudgett\"", 1);
        assert!(parse(&unknown).unwrap_err().contains("repairBudgett"));
        let extra = source.replacen("\"matchMinDot\": 0.95", "\"matchMinDot\": 0.95, \"extra\": 1", 1);
        assert!(parse(&extra).unwrap_err().contains("extra"));
        let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
        value["defaults"].as_object_mut().unwrap().remove("matchToleranceMm");
        assert!(parse(&value.to_string()).unwrap_err().contains("matchToleranceMm"));
        value["thresholds"].as_object_mut().unwrap().insert("surprise".into(), 1.into());
        assert!(parse(&value.to_string()).is_err());
    }

    #[test]
    fn unknown_profile_is_none() {
        assert!(profile("nope").is_none());
        assert_eq!(profile_ids(), vec!["reference-aligner".to_string()]);
    }
}
