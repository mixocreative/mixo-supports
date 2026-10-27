//! Dental ABI (U6a): `orient_dental`, `propose_dental_region`, `retune_dental_region`,
//! `manual_dental_area`. Arrays in, result objects with `take_*` arrays out. A typed error is
//! thrown for bad input; detection that finds nothing is a normal result with a reason.

use mixo_geometry_core::dental::bands::diagnostic_side_bands;
use mixo_geometry_core::dental::footprint::{Contact, RimSide, Tuning};
use mixo_geometry_core::dental::opening::{Opening, central_opening};
use mixo_geometry_core::dental::orient::{Proposal, Reason, propose_orientation};
use mixo_geometry_core::dental::pose::rotation_to_dental_pose;
use mixo_geometry_core::dental::rim::Rim;
use mixo_geometry_core::dental::sampling::{ContourContact, sample_contour_contacts};
use mixo_geometry_core::dental::topology::Context;
use mixo_geometry_core::dental::mesh::Mesh;
use mixo_geometry_core::dental::orientation::{OpeningState, Orientation, orient_dental as orient};
use mixo_geometry_core::dental::policy::{AreaOrigin, DentalPolicy, ManualAreaError, manual_area_policy, policy_from_region};
use mixo_geometry_core::dental::profiles::{self, AlignerProfile};
use mixo_geometry_core::dental::region::{Region, RegionContours, propose_region, retune_region};
use mixo_geometry_core::dental::rim::BoundaryKind;
use super::{GeometrySession, mesh_error};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

use super::coded_error as error;

fn profile_of(id: &str) -> Result<&'static AlignerProfile, JsValue> {
    profiles::profile(id).ok_or_else(|| error("UNKNOWN_PROFILE"))
}

fn mesh_of<'a>(positions: &'a [f32], indices: &'a [u32]) -> Result<Mesh<'a>, JsValue> {
    if positions.len() % 3 != 0 || indices.len() % 3 != 0 {
        return Err(error("INVALID_LENGTH"));
    }
    if indices.iter().any(|&i| i as usize >= positions.len() / 3) {
        return Err(error("INVALID_INDEX"));
    }
    Ok(Mesh::new(positions, indices))
}

/// Step 1 result. Failed: `status() == 1` with `reason()`. Oriented: `status() == 0`.
#[wasm_bindgen]
pub struct DentalOrientResult {
    status: u32,
    reason: String,
    mesh_ok: bool,
    opening: u32,
    rotation: Vec<f64>,
    diagnostics: Vec<f64>,
    rim_scalars: Vec<f64>,
    rim_points: Vec<f32>,
    visibility_mask: Vec<u8>,
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
}

#[wasm_bindgen]
pub fn orient_dental(positions: &[f32], indices: &[u32], profile: &str) -> Result<DentalOrientResult, JsValue> {
    let profile = profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    let mut out = DentalOrientResult { status: 1, reason: String::new(), mesh_ok: false, opening: 2, rotation: Vec::new(), diagnostics: Vec::new(), rim_scalars: Vec::new(), rim_points: Vec::new(), visibility_mask: Vec::new() };
    match orient(&mesh, profile) {
        Orientation::Failed { reason, mesh_ok } => {
            out.reason = reason.code().to_string();
            out.mesh_ok = mesh_ok;
        }
        Orientation::Oriented { rim, diagnostics, rotation, opening, mesh_ok, opening_reason } => {
            out.status = 0;
            out.mesh_ok = mesh_ok;
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

/// A detected region: contours, face cut, contact strip, contacts and the `PolicyResult` fields.
#[wasm_bindgen]
pub struct DentalRegionResult {
    ok: bool,
    reason: String,
    region: Region,
    policy: Option<DentalPolicy>,
}

fn contact_bytes(contacts: &[Contact]) -> (Vec<u32>, Vec<f64>, Vec<f64>, Vec<u8>) {
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
    /// The contact strip, which is also `PolicyResult.permitted_faces` (1 byte per face).
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
    /// `PolicyResult.candidates` ids, one per contact in the same order.
    pub fn candidate_ids(&self) -> Vec<String> {
        self.policy.as_ref().map(|p| p.result.candidates.iter().map(|c| c.id.0.clone()).collect()).unwrap_or_default()
    }
    /// pillar, tree, brace, roof, cage, raft (1 = allowed). Dental: roof and cage 0.
    pub fn structures(&self) -> Vec<u8> {
        self.policy.as_ref().map(|p| {
            let s = p.result.structures;
            [s.pillar, s.tree, s.brace, s.roof, s.cage, s.raft].map(u8::from).to_vec()
        }).unwrap_or_default()
    }
    pub fn repair_budget(&self) -> u32 {
        self.policy.as_ref().map_or(0, |p| p.result.repair_budget)
    }
    /// 0 detected, 1 manual-area.
    pub fn area_origin(&self) -> u32 {
        self.policy.as_ref().map_or(0, |p| u32::from(p.area_origin == AreaOrigin::ManualArea))
    }
}

fn empty_region() -> Region {
    Region { contours: RegionContours::default(), allowed_faces: Vec::new(), region_faces: [0, 0], connector_lengths: [0.0; 2], contact_faces: Vec::new(), contacts: Vec::new() }
}

fn tuning_of(values: &[f64]) -> Result<Tuning, JsValue> {
    match values {
        [setback_mm, strip_width_mm, density] => Ok(Tuning { setback_mm: *setback_mm, strip_width_mm: *strip_width_mm, density: *density }),
        _ => Err(error("INVALID_LENGTH")),
    }
}

fn finish(result: Result<Region, String>, profile: &AlignerProfile) -> DentalRegionResult {
    match result {
        Ok(region) => {
            let policy = policy_from_region(&region, profile);
            DentalRegionResult { ok: true, reason: String::new(), region, policy: Some(policy) }
        }
        Err(reason) => DentalRegionResult { ok: false, reason, region: empty_region(), policy: None },
    }
}

/// Detects the contours, the face cut and the contact strip, tuned by `[setback, width, density]`.
#[wasm_bindgen]
pub fn propose_dental_region(positions: &[f32], indices: &[u32], tuning: &[f64], profile: &str) -> Result<DentalRegionResult, JsValue> {
    let profile = profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    Ok(finish(propose_region(&mesh, &tuning_of(tuning)?, profile), profile))
}

/// Recomputes the strip and contacts for accepted contours. `phase_fraction` NaN keeps the usual
/// half-spacing phase; 0 samples from the contour origin.
#[wasm_bindgen]
pub fn retune_dental_region(
    positions: &[f32],
    indices: &[u32],
    allowed_faces: &[u8],
    outer_edges: &[u32],
    opening_edges: &[u32],
    tuning: &[f64],
    phase_fraction: f64,
    profile: &str,
) -> Result<DentalRegionResult, JsValue> {
    let profile = profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    if allowed_faces.len() != mesh.face_count() || outer_edges.len() % 2 != 0 || opening_edges.len() % 2 != 0 {
        return Err(error("INVALID_LENGTH"));
    }
    if outer_edges.iter().chain(opening_edges).any(|&i| i as usize >= mesh.vertex_count()) {
        return Err(error("INVALID_INDEX"));
    }
    let region = Region {
        contours: RegionContours { outer_edges: outer_edges.to_vec(), opening_edges: opening_edges.to_vec(), ..Default::default() },
        allowed_faces: allowed_faces.to_vec(),
        ..empty_region()
    };
    let phase = (!phase_fraction.is_nan()).then_some(phase_fraction);
    Ok(finish(retune_region(&mesh, region, &tuning_of(tuning)?, profile, phase), profile))
}

/// Permission from an area painted from scratch (marked origin `manual-area`). Returns the mask,
/// one byte per face. Throws `DETECTED_AREA_EXISTS` when detection found an area (paint never
/// replaces a detected area) and `INVALID_INDEX` for a face outside the mesh.
#[wasm_bindgen]
pub fn manual_dental_area(face_count: u32, painted_faces: &[u32], detected: bool, profile: &str) -> Result<Vec<u8>, JsValue> {
    let profile = profile_of(profile)?;
    let detected_region = detected.then(empty_region);
    match manual_area_policy(face_count as usize, painted_faces, detected_region.as_ref(), profile) {
        Ok(policy) => Ok((0..face_count as usize).map(|f| u8::from(policy.result.permitted_faces.get(f))).collect()),
        Err(ManualAreaError::DetectedAreaExists) => Err(error("DETECTED_AREA_EXISTS")),
        Err(ManualAreaError::FaceOutOfRange(_)) => Err(error("INVALID_INDEX")),
    }
}

#[wasm_bindgen]
pub fn dental_profile_ids() -> Vec<String> {
    profiles::profile_ids()
}

/// A rim rebuilt from the scalars `DentalOrientResult::rim_scalars` returns (frame only; the loop
/// points and visibility footprint are not needed by pose and opening detection).
fn rim_from_scalars(values: &[f64]) -> Result<Rim, JsValue> {
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

fn fill_rim(out: &mut DentalOrientResult, rim: Rim) {
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

fn blank_orient() -> DentalOrientResult {
    DentalOrientResult { status: 1, reason: String::new(), mesh_ok: false, opening: 2, rotation: Vec::new(), diagnostics: Vec::new(), rim_scalars: Vec::new(), rim_points: Vec::new(), visibility_mask: Vec::new() }
}

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

/// Euler XYZ radians restoring the reference pose, or empty for an ambiguous arch.
#[wasm_bindgen]
pub fn dental_pose(positions: &[f32], indices: &[u32], rim_scalars: &[f64]) -> Result<Vec<f64>, JsValue> {
    let mesh = mesh_of(positions, indices)?;
    Ok(rotation_to_dental_pose(&mesh, &rim_from_scalars(rim_scalars)?).map(|r| r.to_vec()).unwrap_or_default())
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

/// `phase_mm` NaN keeps the half-spacing phase.
#[wasm_bindgen]
pub fn dental_sample_contacts(positions: &[f32], indices: &[u32], contour: &[u32], side_band: &[u8], spacing: f64, max_search: f64, phase_mm: f64) -> Result<DentalSampleResult, JsValue> {
    let mesh = mesh_of(positions, indices)?;
    if contour.iter().any(|&i| i as usize >= mesh.vertex_count()) {
        return Ok(DentalSampleResult { ok: false, reason: "invalid-contour".into(), skipped: 0, perimeter: 0.0, contacts: Vec::new() });
    }
    let phase = (!phase_mm.is_nan()).then_some(phase_mm);
    Ok(match sample_contour_contacts(&mesh, contour, side_band, spacing, max_search, phase) {
        Ok(s) => DentalSampleResult { ok: true, reason: String::new(), skipped: s.skipped_samples as u32, perimeter: s.perimeter, contacts: s.contacts },
        Err(reason) => DentalSampleResult { ok: false, reason: reason.into(), skipped: 0, perimeter: 0.0, contacts: Vec::new() },
    })
}

/// The contact footprint for explicit strip settings:
/// `[setback, width, outerSpacing, innerSpacing, maxSearch, phaseFraction]` (phase NaN = default
/// half-spacing). `ok()` false carries the raw reason; contacts and the strip come from the
/// `contact_*` and `take_contact_faces` calls, `PolicyResult` fields are not produced here.
#[wasm_bindgen]
pub fn dental_footprint(positions: &[f32], indices: &[u32], allowed_faces: &[u8], outer_edges: &[u32], opening_edges: &[u32], settings: &[f64]) -> Result<DentalRegionResult, JsValue> {
    use mixo_geometry_core::dental::footprint::{FootprintSettings, propose_footprint};
    let mesh = mesh_of(positions, indices)?;
    if allowed_faces.len() != mesh.face_count() || outer_edges.len() % 2 != 0 || opening_edges.len() % 2 != 0 || settings.len() != 6 {
        return Err(error("INVALID_LENGTH"));
    }
    if outer_edges.iter().chain(opening_edges).any(|&i| i as usize >= mesh.vertex_count()) {
        return Err(error("INVALID_INDEX"));
    }
    let settings = FootprintSettings {
        setback: settings[0],
        width: settings[1],
        outer_spacing: settings[2],
        inner_spacing: settings[3],
        max_search_distance: settings[4],
        sample_phase_fraction: (!settings[5].is_nan()).then_some(settings[5]),
    };
    Ok(match propose_footprint(&mesh, allowed_faces, outer_edges, opening_edges, &settings) {
        Ok(footprint) => {
            let contacts = footprint
                .outer_contacts
                .into_iter()
                .map(|contact| Contact { rim: RimSide::Outer, contact })
                .chain(footprint.inner_contacts.into_iter().map(|contact| Contact { rim: RimSide::Opening, contact }))
                .collect();
            DentalRegionResult { ok: true, reason: String::new(), region: Region { contact_faces: footprint.contact_faces, contacts, ..empty_region() }, policy: None }
        }
        Err(reason) => DentalRegionResult { ok: false, reason: reason.into(), region: empty_region(), policy: None },
    })
}

/// Permission from an area painted from scratch, given as ordered brush stamps: 8 numbers each
/// (center XYZ, radius, normal XYZ, 1 for add / 0 for remove). Same contract as
/// `manual_dental_area`: throws `DETECTED_AREA_EXISTS` when detection found an area.
#[wasm_bindgen]
pub fn manual_dental_area_from_stamps(positions: &[f32], indices: &[u32], stamps: &[f64], detected: bool, profile: &str) -> Result<Vec<u8>, JsValue> {
    use mixo_geometry_core::dental::policy::{Stamp, faces_painted_by_stamps};
    let profile = profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    if stamps.len() % 8 != 0 {
        return Err(error("INVALID_LENGTH"));
    }
    let stamps: Vec<Stamp> = stamps
        .chunks_exact(8)
        .map(|s| Stamp { center: [s[0], s[1], s[2]], radius: s[3], normal: [s[4], s[5], s[6]], allow: s[7] == 1.0 })
        .collect();
    let painted = faces_painted_by_stamps(&mesh, &stamps);
    let detected_region = detected.then(empty_region);
    match manual_area_policy(mesh.face_count(), &painted, detected_region.as_ref(), profile) {
        Ok(policy) => Ok((0..mesh.face_count()).map(|f| u8::from(policy.result.permitted_faces.get(f))).collect()),
        Err(ManualAreaError::DetectedAreaExists) => Err(error("DETECTED_AREA_EXISTS")),
        Err(ManualAreaError::FaceOutOfRange(_)) => Err(error("INVALID_INDEX")),
    }
}

/// A rim with its visibility footprint: the 18 `rim_scalars` plus the footprint's byte mask.
fn footprint_rim(values: &[f64], mask: &[u8]) -> Result<Rim, JsValue> {
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

fn area_stamps(stamps: &[f64]) -> Result<Vec<mixo_geometry_core::supports::policy::AreaStamp>, JsValue> {
    if stamps.len() % 8 != 0 {
        return Err(error("INVALID_LENGTH"));
    }
    Ok(stamps
        .chunks_exact(8)
        .map(|s| mixo_geometry_core::supports::policy::AreaStamp { center: [s[0], s[1], s[2]], radius: s[3], normal: [s[4], s[5], s[6]], allow: s[7] == 1.0 })
        .collect())
}

/// The legacy dental placement (a painted-from-scratch area or an older saved policy), see
/// `dental::legacy`: the generic contacts the area permits plus the downward faces filled at
/// `spacing`. Positions and normals are in the turned frame (`rotation`, Euler XYZ radians).
#[wasm_bindgen]
pub struct LegacyFill {
    kept: Vec<u32>,
    positions: Vec<f64>,
    normals: Vec<f64>,
    ids: Vec<String>,
}

#[wasm_bindgen]
impl LegacyFill {
    /// Indices (into the generic contacts passed in) that were kept, in order.
    pub fn take_kept(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.kept)
    }
    /// Contacts the face fill added.
    pub fn take_positions(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.positions)
    }
    pub fn take_normals(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.normals)
    }
    pub fn take_ids(&mut self) -> Vec<String> {
        std::mem::take(&mut self.ids)
    }
}

#[wasm_bindgen]
pub fn dental_legacy_fill(
    positions: &[f32],
    indices: &[u32],
    rim: &[f64],
    visibility_mask: &[u8],
    manual_area: bool,
    stamps: &[f64],
    rotation: &[f64],
    spacing: f64,
    overhang_angle_degrees: f64,
    initial_positions: &[f64],
    initial_normals: &[f64],
) -> Result<LegacyFill, JsValue> {
    use mixo_geometry_core::dental::legacy::{FillInput, LegacyArea, fill_legacy_dental};
    let mesh = mesh_of(positions, indices)?;
    let rim = footprint_rim(rim, visibility_mask)?;
    let stamps = area_stamps(stamps)?;
    if rotation.len() != 3 || initial_positions.len() % 3 != 0 || initial_positions.len() != initial_normals.len() || !(spacing > 0.0) || !spacing.is_finite() {
        return Err(error("INVALID_LENGTH"));
    }
    let area = LegacyArea { rim: &rim, manual_area, stamps: &stamps };
    let input = FillInput { mesh, rotation: [rotation[0], rotation[1], rotation[2]], spacing, overhang_angle_degrees, initial_positions, initial_normals };
    let fill = fill_legacy_dental(&area, &input);
    Ok(LegacyFill { kept: fill.kept_initial, positions: fill.positions, normals: fill.normals, ids: fill.ids })
}

/// One byte per mesh vertex: the legacy allowed-area overlay (the footprint or the paint, and
/// seen first from the opening). `normals` is one unit-frame normal per vertex, or empty.
#[wasm_bindgen]
pub fn dental_allowed_vertices(positions: &[f32], indices: &[u32], normals: &[f32], rim: &[f64], visibility_mask: &[u8], manual_area: bool, stamps: &[f64]) -> Result<Vec<u8>, JsValue> {
    use mixo_geometry_core::dental::legacy::LegacyArea;
    let mesh = mesh_of(positions, indices)?;
    let rim = footprint_rim(rim, visibility_mask)?;
    let stamps = area_stamps(stamps)?;
    if !normals.is_empty() && normals.len() != positions.len() {
        return Err(error("INVALID_LENGTH"));
    }
    Ok(LegacyArea { rim: &rim, manual_area, stamps: &stamps }.allowed_vertices(mesh, normals))
}

/// The review GLB data of `diagnose`: coloured layers, one per role (docs/SHIP-PLAN.md ABI).
#[wasm_bindgen]
pub struct Diagnosis {
    revision: u32,
    layers: Vec<mixo_geometry_core::dental::review::Layer>,
}

#[wasm_bindgen]
impl Diagnosis {
    /// The request revision, echoed.
    pub fn revision(&self) -> u32 {
        self.revision
    }
    pub fn layer_count(&self) -> u32 {
        self.layers.len() as u32
    }
    pub fn layer_name(&self, layer: u32) -> String {
        self.layers.get(layer as usize).map(|l| l.name.to_string()).unwrap_or_default()
    }
    /// 0xRRGGBB.
    pub fn layer_color(&self, layer: u32) -> u32 {
        self.layers.get(layer as usize).map_or(0, |l| l.color)
    }
    pub fn take_layer_positions(&mut self, layer: u32) -> Vec<f32> {
        self.layers.get_mut(layer as usize).map(|l| std::mem::take(&mut l.positions)).unwrap_or_default()
    }
    /// Empty: the positions are a triangle soup.
    pub fn take_layer_indices(&mut self, layer: u32) -> Vec<u32> {
        self.layers.get_mut(layer as usize).map(|l| std::mem::take(&mut l.indices)).unwrap_or_default()
    }
}

#[wasm_bindgen]
impl GeometrySession {
    /// Review layers of a loaded aligner: the contact strip, the contours and, when given, the
    /// diagnostic strips (`bands`: four masks of one byte per face, or empty), the sampled
    /// contacts (position then normal, 6 numbers each), and a support mesh with a tip flag per
    /// triangle. Review only; nothing here is support permission.
    pub fn diagnose(
        &self,
        model: u32,
        revision: u32,
        contact_faces: &[u8],
        outer_ridge_edges: &[u32],
        connector_edges: &[u32],
        opening_edges: &[u32],
        bands: &[u8],
        outer_contacts: &[f64],
        inner_contacts: &[f64],
        support_positions: &[f32],
        support_indices: &[u32],
        tip_flags: &[u8],
    ) -> Result<Diagnosis, JsValue> {
        use mixo_geometry_core::dental::review::{ReviewError, ReviewInput, SupportMesh, review_layers};
        let (positions, indices) = self.store.mesh_arrays(model).map_err(mesh_error)?;
        let mesh = mesh_of(positions, indices)?;
        let faces = mesh.face_count();
        if (!bands.is_empty() && bands.len() != faces * 4) || outer_contacts.len() % 6 != 0 || inner_contacts.len() % 6 != 0 {
            return Err(error("INVALID_LENGTH"));
        }
        let band_views = (!bands.is_empty()).then(|| [&bands[..faces], &bands[faces..faces * 2], &bands[faces * 2..faces * 3], &bands[faces * 3..]]);
        let support = (!support_indices.is_empty()).then_some(SupportMesh { positions: support_positions, indices: support_indices, tip_flags });
        if support.is_some() && (support_indices.len() % 3 != 0 || support_indices.iter().any(|&i| i as usize * 3 + 2 >= support_positions.len())) {
            return Err(error("INVALID_INDEX"));
        }
        let input = ReviewInput {
            mesh, contact_faces, outer_ridge: outer_ridge_edges, connectors: connector_edges, opening: opening_edges,
            bands: band_views, outer_contacts, inner_contacts, support,
        };
        let layers = review_layers(&input).map_err(|e| match e {
            ReviewError::ContactMaskMismatch | ReviewError::BandMismatch | ReviewError::SupportMismatch => error("INVALID_LENGTH"),
            ReviewError::EdgeOutOfRange => error("INVALID_INDEX"),
        })?;
        Ok(Diagnosis { revision, layers })
    }
}
