//! Dental ABI (U6a): `orient_dental`, `propose_dental_region`, `retune_dental_region`,
//! `manual_dental_area`. Arrays in, result objects with `take_*` arrays out. A typed error is
//! thrown for bad input; detection that finds nothing is a normal result with a reason.

use mixo_geometry_core::dental::footprint::{Contact, RimSide, Tuning};
use mixo_geometry_core::dental::mesh::Mesh;
use mixo_geometry_core::dental::orientation::{OpeningState, Orientation, orient_dental as orient};
use mixo_geometry_core::dental::policy::{AreaOrigin, DentalPolicy, ManualAreaError, manual_area_policy, policy_from_region};
use mixo_geometry_core::dental::profiles::{self, AlignerProfile};
use mixo_geometry_core::dental::region::{Region, RegionContours, propose_region, retune_region};
use mixo_geometry_core::dental::rim::BoundaryKind;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

fn error(code: &str) -> JsValue {
    let exception = js_sys::Error::new(code);
    let _ = js_sys::Reflect::set(exception.as_ref(), &JsValue::from_str("code"), &JsValue::from_str(code));
    exception.into()
}

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
