//! Dental internals for tests and review scripts only (`--features test-abi`, the Node package the
//! tests load): the cavity proposal, pose, opening, side bands, contour samplers, footprint, the
//! painted-area masks and the profile list. The browser build has none of these; the host needs only
//! the calls in `dental.rs`.

use super::dental::{DentalOrientResult, DentalRegionResult, area_stamps, blank_orient, empty_region, error, fill_rim, mesh_of, profile_of, rim_from_scalars, tuning_of};
use mixo_geometry_core::dental::bands::diagnostic_side_bands;
use mixo_geometry_core::dental::footprint::{Contact, RimSide};
use mixo_geometry_core::dental::opening::{Opening, central_opening};
use mixo_geometry_core::dental::orient::{Proposal, Reason, propose_orientation};
use mixo_geometry_core::dental::policy::{ManualAreaError, faces_painted_by_stamps, manual_area_faces};
use mixo_geometry_core::dental::pose::rotation_to_dental_pose;
use mixo_geometry_core::dental::profiles;
use mixo_geometry_core::dental::region::Region;
use mixo_geometry_core::dental::sampling::{ContourContact, SampleSettings, sample_contour_contacts};
use mixo_geometry_core::dental::topology::Context;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

/// The cavity opening and its rim only (no central-opening or pose evaluation). `status()` 0 is a
/// proposal; 1 is inconclusive with `reason()`.
#[wasm_bindgen]
pub fn propose_dental_orientation(positions: &[f32], indices: &[u32], profile: &str) -> Result<DentalOrientResult, JsValue> {
    let profile = profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    let mut out = blank_orient();
    match propose_orientation(&mesh, profile) {
        Proposal::Inconclusive { reason, diagnostics } => {
            out.reason = reason.code().to_string();
            out.diagnostics = vec![diagnostics.confidence, diagnostics.terminal_area_ratio, diagnostics.axial_variance_ratio];
            out.mesh_ok = reason != Reason::InvalidMesh;
        }
        Proposal::Proposal { rim, diagnostics } => {
            out.status = 0;
            out.mesh_ok = true;
            out.diagnostics = vec![diagnostics.confidence, diagnostics.terminal_area_ratio, diagnostics.axial_variance_ratio];
            fill_rim(&mut out, rim);
        }
    }
    Ok(out)
}

/// Euler XYZ radians restoring the profile's target pose, or empty for an ambiguous arch.
#[wasm_bindgen]
pub fn dental_pose(positions: &[f32], indices: &[u32], rim_scalars: &[f64], profile: &str) -> Result<Vec<f64>, JsValue> {
    let profile = profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    Ok(rotation_to_dental_pose(&mesh, &rim_from_scalars(rim_scalars)?, profile).map(|r| r.to_vec()).unwrap_or_default())
}

/// Central opening of a closed mesh for a known rim frame. `kind()` 0 present, 1 absent, 2 ambiguous.
#[wasm_bindgen]
pub struct DentalOpeningResult {
    kind: u32,
    reason: String,
    edges: Vec<u32>,
}

#[wasm_bindgen]
impl DentalOpeningResult {
    pub fn kind(&self) -> u32 {
        self.kind
    }
    pub fn reason(&self) -> String {
        self.reason.clone()
    }
    /// Opening loop as vertex pairs sorted by edge key.
    pub fn take_edges(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.edges)
    }
}

#[wasm_bindgen]
pub fn inspect_dental_opening(positions: &[f32], indices: &[u32], rim_scalars: &[f64], profile: &str) -> Result<DentalOpeningResult, JsValue> {
    let profile = profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    let rim = rim_from_scalars(rim_scalars)?;
    let Some(context) = Context::build(&mesh, &rim) else {
        return Ok(DentalOpeningResult { kind: 2, reason: "invalid-mesh".into(), edges: Vec::new() });
    };
    Ok(match central_opening(&context, profile) {
        Opening::Present(mut edges) => {
            edges.sort_by_key(|&e| context.edges[e].key);
            DentalOpeningResult { kind: 0, reason: String::new(), edges: edges.iter().flat_map(|&e| [context.edges[e].a, context.edges[e].b]).collect() }
        }
        Opening::Absent => DentalOpeningResult { kind: 1, reason: String::new(), edges: Vec::new() },
        Opening::Ambiguous(reason) => DentalOpeningResult { kind: 2, reason: reason.into(), edges: Vec::new() },
    })
}

/// Diagnostic strips on both sides of each contour; `ok()` false carries the reason.
#[wasm_bindgen]
pub struct DentalBandsResult {
    ok: bool,
    reason: String,
    bands: Vec<Vec<u8>>,
}

#[wasm_bindgen]
impl DentalBandsResult {
    pub fn ok(&self) -> bool {
        self.ok
    }
    pub fn reason(&self) -> String {
        self.reason.clone()
    }
    /// One band mask (1 byte per face): 0 outer opening side, 1 outer other side, 2 inner opening side, 3 inner other side.
    pub fn take_band(&mut self, index: u32) -> Vec<u8> {
        self.bands.get_mut(index as usize).map(std::mem::take).unwrap_or_default()
    }
}

#[wasm_bindgen]
pub fn dental_side_bands(positions: &[f32], indices: &[u32], allowed_faces: &[u8], outer_edges: &[u32], opening_edges: &[u32], setback: f64, width: f64) -> Result<DentalBandsResult, JsValue> {
    let mesh = mesh_of(positions, indices)?;
    if outer_edges.iter().chain(opening_edges).any(|&i| i as usize >= mesh.vertex_count()) {
        return Err(error("INVALID_INDEX"));
    }
    Ok(match diagnostic_side_bands(&mesh, allowed_faces, outer_edges, opening_edges, setback, width) {
        Ok(b) => DentalBandsResult { ok: true, reason: String::new(), bands: vec![b.outer_opening_side, b.outer_other_side, b.inner_opening_side, b.inner_other_side] },
        Err(reason) => DentalBandsResult { ok: false, reason: reason.into(), bands: Vec::new() },
    })
}

/// Arclength contact samples on one contour side band.
#[wasm_bindgen]
pub struct DentalSampleResult {
    ok: bool,
    reason: String,
    skipped: u32,
    perimeter: f64,
    contacts: Vec<ContourContact>,
}

#[wasm_bindgen]
impl DentalSampleResult {
    pub fn ok(&self) -> bool {
        self.ok
    }
    pub fn reason(&self) -> String {
        self.reason.clone()
    }
    pub fn skipped_samples(&self) -> u32 {
        self.skipped
    }
    pub fn perimeter(&self) -> f64 {
        self.perimeter
    }
    pub fn faces(&self) -> Vec<u32> {
        self.contacts.iter().map(|c| c.face).collect()
    }
    /// Position XYZ then normal XYZ per contact.
    pub fn points(&self) -> Vec<f64> {
        self.contacts.iter().flat_map(|c| c.position.into_iter().chain(c.normal)).collect()
    }
    /// Distance along the contour then distance from it, per contact.
    pub fn distances(&self) -> Vec<f64> {
        self.contacts.iter().flat_map(|c| [c.distance_along_contour, c.distance_from_contour]).collect()
    }
}

/// `phase_mm` NaN keeps the half-spacing phase; `min_separation` 0 turns the 3D minimum off.
#[wasm_bindgen]
pub fn dental_sample_contacts(positions: &[f32], indices: &[u32], contour: &[u32], side_band: &[u8], spacing: f64, max_search: f64, phase_mm: f64, min_separation: f64) -> Result<DentalSampleResult, JsValue> {
    let mesh = mesh_of(positions, indices)?;
    if contour.iter().any(|&i| i as usize >= mesh.vertex_count()) {
        return Ok(DentalSampleResult { ok: false, reason: "invalid-contour".into(), skipped: 0, perimeter: 0.0, contacts: Vec::new() });
    }
    let phase = (!phase_mm.is_nan()).then_some(phase_mm);
    let settings = SampleSettings { spacing, max_search, phase_mm: phase, min_separation, keep_clear_of: &[], tip_line: None };
    Ok(match sample_contour_contacts(&mesh, contour, side_band, &settings) {
        Ok(s) => DentalSampleResult { ok: true, reason: String::new(), skipped: s.skipped_samples as u32, perimeter: s.perimeter, contacts: s.contacts },
        Err(reason) => DentalSampleResult { ok: false, reason: reason.into(), skipped: 0, perimeter: 0.0, contacts: Vec::new() },
    })
}

/// The area a tuning `[position, width, density]` gives on `profile`, as signed contour distances
/// `[low, high]` (`Tuning::band`), so review scripts draw the same area as the app.
#[wasm_bindgen]
pub fn dental_area_band(tuning: &[f64], profile: &str) -> Result<Vec<f64>, JsValue> {
    use mixo_geometry_core::dental::footprint::footprint_settings;
    let profile = profile_of(profile)?;
    let settings = footprint_settings(&tuning_of(tuning)?, profile).map_err(|_| error("BAD_INPUT"))?;
    Ok(vec![settings.low, settings.high])
}

/// The contact footprint for explicit strip settings:
/// `[low, high, outerSpacing, innerSpacing, maxSearch, phaseFraction, minTipSeparation]`: the area is
/// the faces whose signed contour distance lies in `[low, high]` (negative across the edge), tips on
/// its middle line (phase NaN = default half-spacing; separation 0 = off). `ok()` false carries the
/// raw reason.
#[wasm_bindgen]
pub fn dental_footprint(positions: &[f32], indices: &[u32], allowed_faces: &[u8], outer_edges: &[u32], opening_edges: &[u32], settings: &[f64]) -> Result<DentalRegionResult, JsValue> {
    use mixo_geometry_core::dental::footprint::{FootprintSettings, propose_footprint};
    let mesh = mesh_of(positions, indices)?;
    if allowed_faces.len() != mesh.face_count() || outer_edges.len() % 2 != 0 || opening_edges.len() % 2 != 0 || settings.len() != 7 {
        return Err(error("INVALID_LENGTH"));
    }
    if outer_edges.iter().chain(opening_edges).any(|&i| i as usize >= mesh.vertex_count()) {
        return Err(error("INVALID_INDEX"));
    }
    let settings = FootprintSettings {
        low: settings[0],
        high: settings[1],
        reach: [settings[1].max(0.0), (-settings[0]).max(0.0)],
        outer_spacing: settings[2],
        inner_spacing: settings[3],
        max_search_distance: settings[4],
        sample_phase_fraction: (!settings[5].is_nan()).then_some(settings[5]),
        min_tip_separation: settings[6],
    };
    Ok(match propose_footprint(&mesh, allowed_faces, outer_edges, opening_edges, &settings) {
        Ok(footprint) => {
            let contacts = footprint
                .outer_contacts
                .into_iter()
                .map(|contact| Contact { rim: RimSide::Outer, contact })
                .chain(footprint.inner_contacts.into_iter().map(|contact| Contact { rim: RimSide::Opening, contact }))
                .collect();
            DentalRegionResult { ok: true, reason: String::new(), region: Region { contact_faces: footprint.contact_faces, contacts, ..empty_region() } }
        }
        Err(reason) => DentalRegionResult { ok: false, reason: reason.into(), region: empty_region() },
    })
}

fn mask_or_error(face_count: usize, painted: &[u32], detected: bool) -> Result<Vec<u8>, JsValue> {
    match manual_area_faces(face_count, painted, detected) {
        Ok(mask) => Ok((0..face_count).map(|f| u8::from(mask.get(f))).collect()),
        Err(ManualAreaError::DetectedAreaExists) => Err(error("DETECTED_AREA_EXISTS")),
        Err(ManualAreaError::FaceOutOfRange(_)) => Err(error("INVALID_INDEX")),
    }
}

/// Permission from an area painted from scratch (origin `manual-area`), one byte per face. Throws
/// `DETECTED_AREA_EXISTS` when detection found an area and `INVALID_INDEX` for a face outside the mesh.
#[wasm_bindgen]
pub fn manual_dental_area(face_count: u32, painted_faces: &[u32], detected: bool, profile: &str) -> Result<Vec<u8>, JsValue> {
    profile_of(profile)?;
    mask_or_error(face_count as usize, painted_faces, detected)
}

/// `manual_dental_area` from ordered brush stamps (8 numbers each).
#[wasm_bindgen]
pub fn manual_dental_area_from_stamps(positions: &[f32], indices: &[u32], stamps: &[f64], detected: bool, profile: &str) -> Result<Vec<u8>, JsValue> {
    profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    let painted = faces_painted_by_stamps(&mesh, &area_stamps(stamps)?);
    mask_or_error(mesh.face_count(), &painted, detected)
}

#[wasm_bindgen]
pub fn dental_profile_ids() -> Vec<String> {
    profiles::profile_ids()
}
