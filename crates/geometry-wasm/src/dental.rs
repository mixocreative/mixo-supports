//! Dental ABI: what the host needs and nothing more (docs/SHIP-PLAN.md, ABI). Every call works on a
//! mesh already loaded in the `GeometrySession` (no mesh copy per call) and names its aligner profile:
//! `orient_dental`, `propose_dental_region` / `retune_dental_region` (Step 2 display),
//! `dental_policy` (the `PolicyResult` for `generate`, made here, never assembled by the host),
//! `dental_legacy_fill` (placement of a painted area), `diagnose` (review layers) and the overlay
//! mask `dental_allowed_vertices`. Internals (bands, samplers, footprint, pose, opening) are behind
//! the `test-abi` feature (`dental_test_abi.rs`). Bad input throws a typed error; detection that
//! finds nothing is a normal result with a reason.

use mixo_geometry_core::dental::footprint::{Contact, RimSide, Tuning};
use mixo_geometry_core::dental::mesh::Mesh;
use mixo_geometry_core::dental::orientation::{OpeningState, Orientation, matches_profile, orient_dental as orient};

use mixo_geometry_core::dental::profiles::{self, AlignerProfile};
use mixo_geometry_core::dental::region::{Region, RegionContours, propose_region, retune_region};
use mixo_geometry_core::dental::rim::{BoundaryKind, Rim};
use mixo_geometry_core::dental::tilt::{Failing, PickReason, RULES, ScanArgs, TiltScan, tilt_scan_with};
use mixo_geometry_core::supports::policy::AreaStamp;
use super::{GeometrySession, mesh_error};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

pub(crate) use super::coded_error as error;

pub(crate) fn profile_of(id: &str) -> Result<&'static AlignerProfile, JsValue> {
    profiles::profile(id).ok_or_else(|| error("UNKNOWN_PROFILE"))
}

pub(crate) fn mesh_of<'a>(positions: &'a [f32], indices: &'a [u32]) -> Result<Mesh<'a>, JsValue> {
    if positions.len() % 3 != 0 || indices.len() % 3 != 0 {
        return Err(error("INVALID_LENGTH"));
    }
    if indices.iter().any(|&i| i as usize >= positions.len() / 3) {
        return Err(error("INVALID_INDEX"));
    }
    Ok(Mesh::new(positions, indices))
}

impl GeometrySession {
    /// The loaded mesh `model` as the dental detectors read it (no copy).
    pub(crate) fn mesh(&self, model: u32) -> Result<Mesh<'_>, JsValue> {
        let (positions, indices) = self.store.mesh_arrays(model).map_err(mesh_error)?;
        mesh_of(positions, indices)
    }
}

/// Step 1 result. Failed: `status() == 1` with `reason()`. Oriented: `status() == 0`.
#[wasm_bindgen]
pub struct DentalOrientResult {
    pub(crate) status: u32,
    pub(crate) reason: String,
    pub(crate) mesh_ok: bool,
    pub(crate) opening: u32,
    pub(crate) rotation: Vec<f64>,
    pub(crate) diagnostics: Vec<f64>,
    pub(crate) rim_scalars: Vec<f64>,
    pub(crate) rim_points: Vec<f32>,
    pub(crate) visibility_mask: Vec<u8>,
    pub(crate) matches_profile: bool,
}

#[wasm_bindgen]
impl DentalOrientResult {
    pub fn status(&self) -> u32 {
        self.status
    }
    /// Failure reason, or why the central opening is ambiguous (empty otherwise).
    pub fn reason(&self) -> String {
        self.reason.clone()
    }
    pub fn mesh_ok(&self) -> bool {
        self.mesh_ok
    }
    /// 0 present, 1 absent, 2 ambiguous.
    pub fn opening(&self) -> u32 {
        self.opening
    }
    /// Euler XYZ radians, or empty when the arch front is ambiguous.
    pub fn rotation(&self) -> Vec<f64> {
        self.rotation.clone()
    }
    /// confidence, terminal area ratio, axial variance ratio.
    pub fn diagnostics(&self) -> Vec<f64> {
        self.diagnostics.clone()
    }
    /// kind (0 lower-edge loop, 1 projection fallback), opening direction, centroid, tangent,
    /// bitangent (3 each), visibility resolution, visibility min (2), visibility max (2).
    pub fn rim_scalars(&self) -> Vec<f64> {
        self.rim_scalars.clone()
    }
    pub fn take_rim_points(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.rim_points)
    }
    pub fn take_visibility_mask(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.visibility_mask)
    }
    /// False when the opening found contradicts the profile's expectation (Step 1 mismatch notice).
    pub fn matches_profile(&self) -> bool {
        self.matches_profile
    }
}

pub(crate) fn blank_orient() -> DentalOrientResult {
    DentalOrientResult {
        status: 1,
        reason: String::new(),
        mesh_ok: false,
        opening: 2,
        rotation: Vec::new(),
        diagnostics: Vec::new(),
        rim_scalars: Vec::new(),
        rim_points: Vec::new(),
        visibility_mask: Vec::new(),
        matches_profile: true,
    }
}

/// A detected region: contours, face cut, contact strip and contacts (Step 2 display and review;
/// the policy itself is `dental_policy`).
#[wasm_bindgen]
pub struct DentalRegionResult {
    pub(crate) ok: bool,
    pub(crate) reason: String,
    pub(crate) region: Region,
}

pub(crate) fn contact_bytes(contacts: &[Contact]) -> (Vec<u32>, Vec<f64>, Vec<f64>, Vec<u8>) {
    let faces = contacts.iter().map(|c| c.contact.face).collect();
    let points = contacts.iter().flat_map(|c: &Contact| c.contact.position.into_iter().chain(c.contact.normal)).collect();
    let along = contacts.iter().flat_map(|c| [c.contact.distance_along_contour, c.contact.distance_from_contour]).collect();
    let rims = contacts.iter().map(|c| u8::from(c.rim == RimSide::Opening)).collect();
    (faces, points, along, rims)
}

#[wasm_bindgen]
impl DentalRegionResult {
    pub fn ok(&self) -> bool {
        self.ok
    }
    pub fn reason(&self) -> String {
        self.reason.clone()
    }
    pub fn take_allowed_faces(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.region.allowed_faces)
    }
    pub fn take_outer_edges(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.region.contours.outer_edges)
    }
    pub fn take_outer_ridge_edges(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.region.contours.outer_ridge_edges)
    }
    pub fn take_outer_connector_edges(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.region.contours.outer_connector_edges)
    }
    pub fn take_opening_edges(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.region.contours.opening_edges)
    }
    /// Faces on the opening-facing side, then on the other side.
    pub fn region_faces(&self) -> Vec<u32> {
        self.region.region_faces.iter().map(|&n| n as u32).collect()
    }
    pub fn connector_lengths(&self) -> Vec<f64> {
        self.region.connector_lengths.to_vec()
    }
    /// The contact strip (1 byte per face).
    pub fn take_contact_faces(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.region.contact_faces)
    }
    /// Source face per contact: outer-rim contacts first, then opening-rim contacts.
    pub fn contact_faces_of(&self) -> Vec<u32> {
        contact_bytes(&self.region.contacts).0
    }
    /// Position XYZ then normal XYZ per contact.
    pub fn contact_points(&self) -> Vec<f64> {
        contact_bytes(&self.region.contacts).1
    }
    /// Distance along the contour then distance from it, per contact.
    pub fn contact_distances(&self) -> Vec<f64> {
        contact_bytes(&self.region.contacts).2
    }
    /// 0 outer rim, 1 opening rim, per contact.
    pub fn contact_rims(&self) -> Vec<u8> {
        contact_bytes(&self.region.contacts).3
    }
}

pub(crate) fn empty_region() -> Region {
    Region { contours: RegionContours::default(), allowed_faces: Vec::new(), region_faces: [0, 0], connector_lengths: [0.0; 2], contact_faces: Vec::new(), contacts: Vec::new() }
}

pub(crate) fn tuning_of(values: &[f64]) -> Result<Tuning, JsValue> {
    match values {
        [position_mm, strip_width_mm, density] => Ok(Tuning { position_mm: *position_mm, strip_width_mm: *strip_width_mm, density: *density }),
        _ => Err(error("INVALID_LENGTH")),
    }
}

fn check_region(mesh: &Mesh, allowed_faces: &[u8], outer_edges: &[u32], opening_edges: &[u32]) -> Result<(), JsValue> {
    if allowed_faces.len() != mesh.face_count() || outer_edges.len() % 2 != 0 || opening_edges.len() % 2 != 0 {
        return Err(error("INVALID_LENGTH"));
    }
    if outer_edges.iter().chain(opening_edges).any(|&i| i as usize >= mesh.vertex_count()) {
        return Err(error("INVALID_INDEX"));
    }
    Ok(())
}

pub(crate) fn finish(result: Result<Region, String>) -> DentalRegionResult {
    match result {
        Ok(region) => DentalRegionResult { ok: true, reason: String::new(), region },
        Err(reason) => DentalRegionResult { ok: false, reason, region: empty_region() },
    }
}

#[wasm_bindgen]
impl GeometrySession {
    /// Step 1: mesh check, orientation, central opening and whether they fit the profile.
    pub fn orient_dental(&self, model: u32, profile: &str) -> Result<DentalOrientResult, JsValue> {
        let profile = profile_of(profile)?;
        let mesh = self.mesh(model)?;
        let mut out = blank_orient();
        match orient(&mesh, profile) {
            Orientation::Failed { reason, mesh_ok } => {
                out.reason = reason.code().to_string();
                out.mesh_ok = mesh_ok;
            }
            Orientation::Oriented { rim, diagnostics, rotation, opening, mesh_ok, opening_reason } => {
                out.status = 0;
                out.mesh_ok = mesh_ok;
                out.matches_profile = matches_profile(opening, profile);
                out.opening = match opening {
                    OpeningState::Present => 0,
                    OpeningState::Absent => 1,
                    OpeningState::Ambiguous => 2,
                };
                out.reason = opening_reason.unwrap_or_default().to_string();
                out.rotation = rotation.map(|r| r.to_vec()).unwrap_or_default();
                out.diagnostics = vec![diagnostics.confidence, diagnostics.terminal_area_ratio, diagnostics.axial_variance_ratio];
                fill_rim(&mut out, *rim);
            }
        }
        Ok(out)
    }

    /// Detects the contours, the face cut and the contact strip, tuned by `[setback, width, density]`.
    pub fn propose_dental_region(&self, model: u32, tuning: &[f64], profile: &str) -> Result<DentalRegionResult, JsValue> {
        let profile = profile_of(profile)?;
        let mesh = self.mesh(model)?;
        Ok(finish(propose_region(&mesh, &tuning_of(tuning)?, profile)))
    }

    /// Recomputes the strip and contacts for accepted contours. `phase_fraction` (of the even step)
    /// NaN keeps phase 0, the primaries; 0.5 samples halfway between them.
    pub fn retune_dental_region(
        &self,
        model: u32,
        allowed_faces: &[u8],
        outer_edges: &[u32],
        opening_edges: &[u32],
        tuning: &[f64],
        phase_fraction: f64,
        profile: &str,
    ) -> Result<DentalRegionResult, JsValue> {
        let profile = profile_of(profile)?;
        let mesh = self.mesh(model)?;
        check_region(&mesh, allowed_faces, outer_edges, opening_edges)?;
        let region = Region {
            contours: RegionContours { outer_edges: outer_edges.to_vec(), opening_edges: opening_edges.to_vec(), ..Default::default() },
            allowed_faces: allowed_faces.to_vec(),
            ..empty_region()
        };
        let phase = (!phase_fraction.is_nan()).then_some(phase_fraction);
        Ok(finish(retune_region(&mesh, region, &tuning_of(tuning)?, profile, phase, None)))
    }
}

/// A rim rebuilt from the scalars `DentalOrientResult::rim_scalars` returns (frame only; the loop
/// points and visibility footprint are not needed by pose and opening detection).
pub(crate) fn rim_from_scalars(values: &[f64]) -> Result<Rim, JsValue> {
    if values.len() < 13 {
        return Err(error("INVALID_LENGTH"));
    }
    let v = |at: usize| [values[at], values[at + 1], values[at + 2]];
    Ok(Rim {
        boundary_kind: if values[0] == 0.0 { BoundaryKind::LowerEdgeLoop } else { BoundaryKind::ProjectionFallback },
        points: Vec::new(),
        opening_direction: v(1),
        centroid: v(4),
        tangent: v(7),
        bitangent: v(10),
        visibility_mask: Vec::new(),
        visibility_resolution: 0,
        visibility_min: [0.0; 2],
        visibility_max: [0.0; 2],
    })
}

pub(crate) fn fill_rim(out: &mut DentalOrientResult, rim: Rim) {
    let mut scalars = vec![if rim.boundary_kind == BoundaryKind::LowerEdgeLoop { 0.0 } else { 1.0 }];
    for v in [rim.opening_direction, rim.centroid, rim.tangent, rim.bitangent] {
        scalars.extend(v);
    }
    scalars.push(rim.visibility_resolution as f64);
    scalars.extend(rim.visibility_min);
    scalars.extend(rim.visibility_max);
    out.rim_scalars = scalars;
    out.rim_points = rim.points;
    out.visibility_mask = rim.visibility_mask;
}

/// A rim with its visibility footprint: the 18 `rim_scalars` plus the footprint's byte mask.
pub(crate) fn footprint_rim(values: &[f64], mask: &[u8]) -> Result<Rim, JsValue> {
    if values.len() != 18 {
        return Err(error("INVALID_LENGTH"));
    }
    let mut rim = rim_from_scalars(values)?;
    let resolution = values[13];
    if !(resolution >= 0.0) || resolution.fract() != 0.0 || mask.len() != (resolution * resolution) as usize {
        return Err(error("INVALID_LENGTH"));
    }
    rim.visibility_resolution = resolution as usize;
    rim.visibility_min = [values[14], values[15]];
    rim.visibility_max = [values[16], values[17]];
    rim.visibility_mask = mask.to_vec();
    Ok(rim)
}

/// Area edits: `STAMP_STRIDE` numbers each (centre xyz, radius, normal xyz, 1 add / 0 remove).
pub(crate) const STAMP_STRIDE: usize = 8;

pub(crate) fn area_stamps(stamps: &[f64]) -> Result<Vec<AreaStamp>, JsValue> {
    if stamps.len() % STAMP_STRIDE != 0 {
        return Err(error("INVALID_LENGTH"));
    }
    if stamps.iter().any(|v| !v.is_finite()) {
        return Err(error("NON_FINITE"));
    }
    Ok(stamps
        .chunks_exact(STAMP_STRIDE)
        .map(|s| AreaStamp { center: [s[0], s[1], s[2]], radius: s[3], normal: [s[4], s[5], s[6]], allow: s[7] == 1.0 })
        .collect())
}

/// The print-angle search (`dental_tilt_scan`): one row per scanned tilt in step order, the pick
/// order (the pick first), the pick's reason and the stable band. Failed: `ok() == false` with `reason()`.
#[wasm_bindgen]
pub struct DentalTiltScanResult {
    ok: bool,
    reason: String,
    scan: Option<TiltScan>,
}

#[wasm_bindgen]
impl DentalTiltScanResult {
    pub fn ok(&self) -> bool {
        self.ok
    }
    pub fn reason(&self) -> String {
        self.reason.clone()
    }
    /// The start tilt (degrees).
    pub fn start_deg(&self) -> f64 {
        self.scan.as_ref().map_or(f64::NAN, |s| s.start_deg)
    }
    /// Per row, 12 numbers: tilt (degrees), steps from the start, rule flags (bit 0 resin trap, 1 rim
    /// gap, 2 crossing, 3 too thin), fitting-side tips, largest gap mm, largest slenderness, largest
    /// layer mm², height mm, robust (0/1), rotation Euler XYZ radians (3, as the orient result).
    pub fn rows(&self) -> Vec<f64> {
        let Some(scan) = &self.scan else { return Vec::new() };
        scan.rows
            .iter()
            .zip(&scan.robust)
            .flat_map(|(r, &robust)| {
                let flags = RULES.iter().filter(|&&rule| r.failed(rule)).fold(0u32, |bits, &rule| bits | (1 << rule as u32));
                [r.tilt_deg, f64::from(r.step), f64::from(flags), r.fitting_side_tips as f64, r.largest_gap_mm, r.largest_slenderness, r.largest_layer_mm2, r.height_mm, f64::from(u8::from(robust)), r.rotation[0], r.rotation[1], r.rotation[2]]
            })
            .collect()
    }
    /// Per row and rule (4 per row): the first failing vertex id (resin trap) or tip id, or "".
    pub fn failing(&self) -> Vec<String> {
        let Some(scan) = &self.scan else { return Vec::new() };
        scan.rows
            .iter()
            .flat_map(|r| {
                r.failing.iter().map(|f| match f {
                    None => String::new(),
                    Some(Failing::Vertex(v)) => v.to_string(),
                    Some(Failing::Tip(id)) => id.clone(),
                })
            })
            .collect()
    }
    /// Row indices in pick order: the pick, then the tilts the confirm tries next.
    pub fn order(&self) -> Vec<u32> {
        self.scan.as_ref().map_or_else(Vec::new, |s| s.order.iter().map(|&i| i as u32).collect())
    }
    /// 0 robust, 1 passing (no tilt is robust), 2 failing (no tilt passes).
    pub fn pick_reason(&self) -> u32 {
        match self.scan.as_ref().map(|s| s.reason) {
            Some(PickReason::Robust) => 0,
            Some(PickReason::Passing) => 1,
            _ => 2,
        }
    }
    /// First and last row index of the stable band, or empty.
    pub fn band(&self) -> Vec<u32> {
        self.scan.as_ref().and_then(|s| s.band).map_or_else(Vec::new, |(a, b)| vec![a as u32, b as u32])
    }
}

#[wasm_bindgen]
impl GeometrySession {
    /// Print-angle search over the profile's tilt range (docs/ROADMAP.md F) with the host's current
    /// support settings. `on_tilt(done, total)`, when given, is called after each scanned tilt.
    pub fn dental_tilt_scan(
        &self,
        model: u32,
        profile: &str,
        neck_length_mm: f64,
        pillar_diameter_mm: f64,
        lift_mm: f64,
        braced: bool,
        on_tilt: Option<js_sys::Function>,
    ) -> Result<DentalTiltScanResult, JsValue> {
        let profile = profile_of(profile)?;
        let mesh = self.mesh(model)?;
        let args = ScanArgs { neck_length_mm, pillar_diameter_mm, lift_mm, braced };
        if [neck_length_mm, pillar_diameter_mm, lift_mm].iter().any(|v| !v.is_finite()) {
            return Err(error("NON_FINITE"));
        }
        if !(pillar_diameter_mm > 0.0) || neck_length_mm < 0.0 || lift_mm < 0.0 {
            return Err(error("BAD_INPUT"));
        }
        let progress = |done: usize, total: usize| {
            if let Some(callback) = &on_tilt {
                let _ = callback.call2(&JsValue::NULL, &JsValue::from(done as u32), &JsValue::from(total as u32));
            }
        };
        Ok(match tilt_scan_with(&mesh, profile, &args, progress) {
            Ok(scan) => DentalTiltScanResult { ok: true, reason: String::new(), scan: Some(scan) },
            Err(reason) => DentalTiltScanResult { ok: false, reason, scan: None },
        })
    }
}
