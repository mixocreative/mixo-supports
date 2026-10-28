//! Dental area calls: the `PolicyResult` for `generate` (`dental_policy`) and the legacy placement of
//! a painted or older saved area (`dental_legacy_fill`, `dental_allowed_vertices`).

use super::dental::{area_stamps, error, footprint_rim, mesh_of, profile_of, tuning_of};
use super::safety::PolicyHandle;
use super::GeometrySession;
use mixo_geometry_core::core::matrix::placement_matrix;
use mixo_geometry_core::dental::policy::{DentalArea, DentalPolicyInput, DentalStructure, SavedRegion, dental_policy as make_dental_policy};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

/// The legacy dental placement result: the generic contacts kept and the face-fill contacts added.
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
impl GeometrySession {
    /// The unit's dental policy as a `PolicyResult` for `generate`, made from its saved area and
    /// recomputed on use. `kind` 0 older saved policy, 1 area painted from scratch, 2 two-contour
    /// (then `tuning` `[setback, width, density]` and the saved region arrays are required; a region
    /// that detection does not reproduce permits nothing automatic). `stamps` are the unit-local area
    /// edits (`STAMP_STRIDE` each), `structure` `[tree, brace]` as 0/1, `frame` the unit's placement
    /// `[position xyz, rotation xyz]` the result is expressed in, `manual_positions` the unit's manual
    /// tips (unit-local xyz triples): no suggested tip is offered next to one.
    pub fn dental_policy(
        &self,
        model: u32,
        profile: &str,
        kind: u32,
        tuning: &[f64],
        stamps: &[f64],
        saved_allowed_faces: &[u8],
        saved_contact_faces: &[u8],
        saved_outer_edges: &[u32],
        saved_opening_edges: &[u32],
        structure: &[u8],
        frame: &[f64],
        manual_positions: &[f64],
    ) -> Result<PolicyHandle, JsValue> {
        let profile = profile_of(profile)?;
        let mesh = self.mesh(model)?;
        let stamps = area_stamps(stamps)?;
        let [tree, brace] = structure else { return Err(error("INVALID_LENGTH")) };
        let frame: [f64; 6] = frame.try_into().map_err(|_| error("INVALID_LENGTH"))?;
        if frame.iter().any(|v| !v.is_finite()) {
            return Err(error("NON_FINITE"));
        }
        let frame = placement_matrix([frame[0], frame[1], frame[2]], [frame[3], frame[4], frame[5]]);
        if manual_positions.len() % 3 != 0 {
            return Err(error("INVALID_LENGTH"));
        }
        if manual_positions.iter().any(|v| !v.is_finite()) {
            return Err(error("NON_FINITE"));
        }
        let manual: Vec<[f64; 3]> = manual_positions.chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect();
        let area = match kind {
            0 => DentalArea::Legacy,
            1 => DentalArea::ManualArea,
            2 => {
                // A saved region is only compared with what detection gives now: one made for another
                // mesh (or edited) simply does not reproduce, and the policy permits nothing automatic.
                let tuning = tuning_of(tuning)?.validate(profile).map_err(|_| error("BAD_INPUT"))?;
                let saved = SavedRegion { allowed_faces: saved_allowed_faces, contact_faces: saved_contact_faces, outer_edges: saved_outer_edges, opening_edges: saved_opening_edges };
                DentalArea::TwoContour { tuning, saved }
            }
            _ => return Err(error("BAD_INPUT")),
        };
        let structure = DentalStructure { tree: *tree != 0, brace: *brace != 0 };
        let policy = make_dental_policy(&DentalPolicyInput { mesh: &mesh, profile, area, stamps: &stamps, structure, frame: &frame, keep_clear_of: &manual });
        Ok(PolicyHandle { result: policy.result, reproduced: policy.reproduced, profile_id: policy.profile_id })
    }

    /// The legacy dental placement (a painted-from-scratch area or an older saved policy), see
    /// `dental::legacy`: the generic contacts the area permits plus the downward faces filled at
    /// `spacing`. Positions and normals are in the turned frame (`rotation`, Euler XYZ radians).
    pub fn dental_legacy_fill(
        &self,
        model: u32,
        profile: &str,
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
        profile_of(profile)?;
        let mesh = self.mesh(model)?;
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
}

/// One byte per mesh vertex: the legacy allowed-area overlay (the footprint or the paint, and
/// seen first from the opening). `normals` is one unit-frame normal per vertex, or empty.
#[wasm_bindgen]
pub fn dental_allowed_vertices(positions: &[f32], indices: &[u32], normals: &[f32], rim: &[f64], visibility_mask: &[u8], manual_area: bool, stamps: &[f64], profile: &str) -> Result<Vec<u8>, JsValue> {
    use mixo_geometry_core::dental::legacy::LegacyArea;
    profile_of(profile)?;
    let mesh = mesh_of(positions, indices)?;
    let rim = footprint_rim(rim, visibility_mask)?;
    let stamps = area_stamps(stamps)?;
    if !normals.is_empty() && normals.len() != positions.len() {
        return Err(error("INVALID_LENGTH"));
    }
    Ok(LegacyArea { rim: &rim, manual_area, stamps: &stamps }.allowed_vertices(mesh, normals))
}
