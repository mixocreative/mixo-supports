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

/// Detector thresholds (what counts as an aligner, a ridge, a hole, a region). Anything that stands
/// for a size or a spacing is in millimetres (`…Mm`), never a count of faces, edges or pixels; the
/// rest are angles, ratios of the part's own extent, or raster resolutions. The reference values
/// each one was calibrated against are in `dentalwork/technical-algorithm.md` (Thresholds).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Thresholds {
    pub axial_variance_max: f64,
    pub terminal_area_ratio_min: f64,
    pub terminal_band_fraction: f64,
    pub confidence_min: f64,
    pub sharp_angle_deg: f64,
    /// A closed sharp loop shorter than this (mm) is a triangle-sized crease, not a rim loop
    /// (reference: creases 0.30-0.59 mm, the next loops 2.85 mm; profile value 1).
    pub loop_min_perimeter_mm: f64,
    pub loop_band_fraction: f64,
    pub loop_band_min_mm: f64,
    pub loop_radius_ratio_min: f64,
    pub loop_extent_min: f64,
    /// Minimum length (mm) of the longest and of the second-longest open sharp chain (reference:
    /// 110.2 and 56.1 mm; profile values 35 and 20, the old 500 / 300 edges at its 0.068 mm edge).
    pub ridge_first_min_mm: f64,
    pub ridge_second_min_mm: f64,
    pub ridge_extent_min: f64,
    pub connector_angle_deg: f64,
    pub opening_resolution_low: usize,
    pub opening_resolution_high: usize,
    pub opening_hole_min_fraction: f64,
    /// A silhouette edge belongs to the opening when its midpoint lies within this distance (mm) of
    /// the projected hole, rounded up to whole raster cells at each resolution (reference: lifted
    /// edges within one cell, 0.27 / 0.13 mm, the next silhouette edges 1.2 mm away; profile 0.5).
    pub opening_near_hole_mm: f64,
    /// Minimum perimeter (mm) of the opening loop (reference 90.1 mm; profile 15) ...
    pub opening_loop_min_mm: f64,
    /// ... and the longest a second loop through its one branch vertex may be (mm; reference
    /// 0.80 mm; profile 2.5).
    pub opening_side_loop_max_mm: f64,
    pub region_allowed_mean_min: f64,
    pub region_forbidden_mean_max: f64,
    pub region_allowed_fraction_min: f64,
    pub region_allowed_fraction_max: f64,
    /// Arch front (`pose.rs`): the in-plane spread must be at least this anisotropic ...
    pub arch_front_min_anisotropy: f64,
    /// ... the end bands are scanned on a grid of this many cells per side (a resolution) ...
    pub arch_front_grid_cells: usize,
    /// ... over the middle of the major axis (this fraction excluded at each side) ...
    pub arch_front_side_fraction: f64,
    /// ... in the two end bands of this fraction of the minor axis; the fuller end is the front
    /// when it covers at least this fraction of the grid area (0.0125 = 20 of 40 x 40 cells; the
    /// reference front covers 138) ...
    pub arch_front_end_band_fraction: f64,
    pub arch_front_min_area_fraction: f64,
    /// ... and at least this many times the other end.
    pub arch_front_end_ratio_min: f64,
}

/// The target print pose (`pose.rs`): the opening axis tilted `tilt_deg` from the downward build
/// plate normal (−Y), toward `heading_deg` about the plate normal (0 = toward −Z, positive toward
/// +X), and the arch front rolled `roll_deg` about the opening axis from the plate-up direction.
/// The print-angle search (`tilt.rs`) scans tilts `tilt_deg ± tilt_range_deg` in steps of
/// `tilt_step_deg`; a tilt is robust when the tilts `tilt_margin_deg` either side pass too. Heading
/// and roll stay fixed.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pose {
    pub tilt_deg: f64,
    pub heading_deg: f64,
    pub roll_deg: f64,
    pub tilt_range_deg: f64,
    pub tilt_step_deg: f64,
    pub tilt_margin_deg: f64,
}

/// The print-angle search's hard rules (`tilt.rs`): the most a support may rise per millimetre of
/// pillar diameter (tip height above the plate / pillar diameter) without and with Tree or Brace,
/// and the smallest rise (mm) that makes a lowest point outside the permitted area a resin trap.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stability {
    pub max_slenderness_unbraced: f64,
    pub max_slenderness_braced: f64,
    pub cup_prominence_mm: f64,
}

/// Default area position, width and density, their operator limits, the contact spacing, the
/// repair budget, and how close a built contact must reproduce a candidate. The position is the
/// signed distance (mm, along the surface) of the area's middle line from the detected edge:
/// positive on the outer (non-fitting) side, negative across the edge.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Defaults {
    pub position_mm: f64,
    pub strip_width_mm: f64,
    pub density: f64,
    pub position_min_mm: f64,
    pub position_max_mm: f64,
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
    /// Two contour contacts (same or other contour) are never closer than this (3D, mm). Profile
    /// 0.6: just over one 0.5 mm tip, so it removes the reference's 0.31 mm hairpin pair but keeps
    /// density 1.5 (opening tips 0.64-1.0 mm apart in space) intact.
    pub min_tip_separation_mm: f64,
    /// A tip must be reachable by a support from below in the print pose: its face normal at least
    /// this many degrees from straight up (90: sideways; profile 110: at least 20 degrees below
    /// horizontal). Far stricter than the neck's geometric limit (a 45-degree neck leaves any face
    /// more than 45 degrees from up), because the pillar under a nearly sideways rim face still
    /// crosses the aligner. Calibrated on case-001: 90-105 leave 2-3 opening tips out, 110 none,
    /// 120 six (fewer faces within reach qualify).
    pub tip_min_from_up_deg: f64,
    /// ... otherwise the tip moves to the best face that is, within this surface distance (mm) of
    /// the area on either side of the edge; with none there it stays (the repair decides).
    pub tip_move_max_mm: f64,
}

/// The Step 3 support settings a new aligner of this type starts with (the operator can change
/// every one). The host applies them when the aligner's support area is first detected; the
/// geometry reads them only through the settings it is given. Tree and Brace are the aligner's
/// structure switches; a project saved without switches keeps both on.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportDefaults {
    /// Pillar (column) diameter, mm.
    pub pillar_diameter_mm: f64,
    /// Diameter of the tip end touching the aligner, mm.
    pub tip_diameter_mm: f64,
    /// Lowest aligner point above the plate, mm.
    pub lift_height_mm: f64,
    pub tree: bool,
    pub brace: bool,
    pub raft: bool,
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
    pub pose: Pose,
    pub defaults: Defaults,
    pub supports: SupportDefaults,
    pub stability: Stability,
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
        assert_eq!(profile.thresholds.ridge_first_min_mm, 35.0);
        assert_eq!(profile.pose.tilt_deg, 46.4577512332);
        assert_eq!((profile.pose.tilt_range_deg, profile.pose.tilt_step_deg, profile.pose.tilt_margin_deg), (22.0, 1.0, 2.0));
        let st = &profile.stability;
        assert_eq!((st.max_slenderness_unbraced, st.max_slenderness_braced, st.cup_prominence_mm), (20.0, 35.0, 1.5));
        assert_eq!(profile.defaults.min_tip_separation_mm, 0.6);
        assert_eq!((profile.defaults.tip_min_from_up_deg, profile.defaults.tip_move_max_mm), (110.0, 1.0));
        assert_eq!(profile.thresholds.region_forbidden_mean_max, -0.15);
        assert_eq!((profile.defaults.position_mm, profile.defaults.strip_width_mm, profile.defaults.density), (0.25, 0.5, 1.0));
        assert_eq!((profile.defaults.position_min_mm, profile.defaults.position_max_mm), (-0.4, 2.5));
        assert_eq!((profile.defaults.outer_spacing_mm, profile.defaults.inner_spacing_mm, profile.defaults.max_search_mm), (3.0, 4.0, 1.5));
        assert_eq!((profile.defaults.match_tolerance_mm, profile.defaults.match_min_dot), (0.03, 0.95));
        assert_eq!(profile.name.zh_hant, "標準牙套");
        let s = &profile.supports;
        assert_eq!((s.pillar_diameter_mm, s.tip_diameter_mm, s.lift_height_mm), (1.4, 0.45, 3.5));
        assert_eq!((s.tree, s.brace, s.raft), (false, true, true));
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
        let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
        value["supports"].as_object_mut().unwrap().insert("roof".into(), true.into());
        assert!(parse(&value.to_string()).unwrap_err().contains("roof"));
        value["supports"].as_object_mut().unwrap().remove("roof");
        value["supports"].as_object_mut().unwrap().remove("liftHeightMm");
        assert!(parse(&value.to_string()).unwrap_err().contains("liftHeightMm"));
        let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
        value["pose"].as_object_mut().unwrap().remove("tiltMarginDeg");
        assert!(parse(&value.to_string()).unwrap_err().contains("tiltMarginDeg"));
        let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
        value["stability"].as_object_mut().unwrap().insert("extra".into(), 1.into());
        assert!(parse(&value.to_string()).unwrap_err().contains("extra"));
        value.as_object_mut().unwrap().remove("stability");
        assert!(parse(&value.to_string()).unwrap_err().contains("stability"));
    }

    #[test]
    fn unknown_profile_is_none() {
        assert!(profile("nope").is_none());
        assert_eq!(profile_ids(), vec!["reference-aligner".to_string()]);
    }
}
