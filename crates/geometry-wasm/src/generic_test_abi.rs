//! Support-build internals for the parity tests only (`--features test-abi`, the Node package): the
//! low-level `build_supports` call, the landing cast and the settings layout the host packer checks
//! against. Production builds go through `generate` (`safety.rs`); the browser build has none of these.

use super::{GeometrySession, build_error, coded_error, mesh_error};
use mixo_geometry_core::supports::parts::model as support_model;
use mixo_geometry_core::supports::generate::landing_allowed;
use mixo_geometry_core::supports::parts::landing::Landing;
use mixo_geometry_core::supports::policy::{AllowedStructures, FaceMask, LandingRule, PolicyResult};
use mixo_geometry_core::supports::zones::decode_zones;
use mixo_geometry_core::supports::{build as support_build, flat as support_flat, settings as support_settings};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

#[wasm_bindgen]
pub struct SupportBuild {
    positions: Vec<f32>,
    indices: Vec<u32>,
    tags: Vec<u32>,
    reach: Vec<f64>,
    intents: Vec<f64>,
    dropped: Vec<u32>,
    dropped_by_zones: Vec<u32>,
}

#[wasm_bindgen]
impl SupportBuild {
    pub fn take_positions(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.positions)
    }
    pub fn take_indices(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.indices)
    }
    pub fn take_tags(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.tags)
    }
    pub fn take_reach(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.reach)
    }
    pub fn take_intents(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.intents)
    }
    pub fn take_dropped(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.dropped)
    }
    pub fn take_dropped_by_zones(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.dropped_by_zones)
    }
}

fn landing_mode(code: u32) -> Result<support_build::LandingSource<'static>, JsValue> {
    match code {
        0 => Ok(support_build::LandingSource::Model),
        2 => Ok(support_build::LandingSource::Target),
        _ => Err(coded_error("BAD_INPUT")),
    }
}

fn build_mode(code: u32) -> Result<support_build::BuildMode, JsValue> {
    match code {
        0 => Ok(support_build::BuildMode::Preview),
        1 => Ok(support_build::BuildMode::Export),
        _ => Err(coded_error("BAD_INPUT")),
    }
}

#[wasm_bindgen]
impl GeometrySession {
    /// Builds the support mesh for contacts over a loaded plate-space model (`model` = u32::MAX for
    /// none). `mode`: 0 preview, 1 export. `landings`: 0 exact surface, 2 the line target (exact, then
    /// the voxel remesh unless a Low Poly preview): neck normals and landings are computed here.
    /// `zones` are no-support stamps (`zones::ZONE_STRIDE` f64 each, plate space) and `landing_faces`
    /// a per-face 0/1 mask of where a support may land (empty = no rule; the policy form of this
    /// rule is `generate`'s `PolicyData`). Never returns a partial result.
    pub fn build_supports(
        &mut self,
        model: u32,
        ids: Vec<String>,
        contacts: &[f64],
        shapes: &[f64],
        settings: &[f64],
        mode: u32,
        landings: u32,
        label_text: &str,
        zones: &[f64],
        landing_faces: &[u8],
    ) -> Result<SupportBuild, JsValue> {
        let settings = support_settings::SupportSettings::from_slice(settings).map_err(build_error)?;
        let contacts = support_flat::decode_contacts(&ids, contacts, shapes, &settings.shape).map_err(build_error)?;
        let (mode, source) = (build_mode(mode)?, landing_mode(landings)?);
        let zones = decode_zones(zones).ok_or_else(|| coded_error("BAD_INPUT"))?;
        let built = if model == u32::MAX {
            let host = support_build::HostChoices { label_text, zones: &zones, landing_allowed: None };
            support_build::build_supports(&contacts, &settings, mode, None, source, &host)
        } else {
            self.store.ensure_pick_index(model).map_err(mesh_error)?;
            let (positions, indices, bvh) = self.store.pick_view(model).map_err(mesh_error)?;
            let view = support_model::Model::new(positions, indices, bvh);
            let mut policy = PolicyResult::plain(FaceMask::new(view.face_count()), Vec::new(), AllowedStructures { pillar: true, tree: true, brace: true, roof: true, cage: true, raft: true }, 0);
            if !landing_faces.is_empty() {
                if landing_faces.len() != view.face_count() {
                    return Err(coded_error("BAD_INPUT"));
                }
                for (face, &flag) in landing_faces.iter().enumerate() {
                    policy.permitted_faces.set(face, flag != 0);
                }
                policy.landing_rule = LandingRule::ApprovedFaces { stamps: Vec::new() };
            }
            let allowed = landing_allowed(&view, &policy);
            let host = support_build::HostChoices { label_text, zones: &zones, landing_allowed: allowed.as_ref().map(|f| f as &dyn Fn(&Landing) -> bool) };
            support_build::build_supports(&contacts, &settings, mode, Some(&view), source, &host)
        }
        .map_err(build_error)?;
        let table = support_flat::encode_components(&built);
        Ok(SupportBuild {
            positions: built.positions,
            indices: built.indices,
            tags: table.tags,
            reach: table.reach,
            intents: table.intents,
            dropped: built.dropped,
            dropped_by_zones: built.dropped_by_zones,
        })
    }
    /// Vertical landing casts against a loaded model: for each `from` (xyz), the surface straight
    /// below within `length` as 5 floats (face or -1, y, upward normal xyz).
    pub fn cast_down(&mut self, model: u32, from: &[f64], length: f64) -> Result<Vec<f64>, JsValue> {
        if from.len() % 3 != 0 {
            return Err(coded_error("INVALID_LENGTH"));
        }
        self.store.ensure_pick_index(model).map_err(mesh_error)?;
        let (positions, indices, bvh) = self.store.pick_view(model).map_err(mesh_error)?;
        let view = support_model::Model::new(positions, indices, bvh);
        let mut out = Vec::with_capacity(from.len() / 3 * 5);
        for point in from.chunks(3) {
            match view.cast_down([point[0], point[1], point[2]], length) {
                Some(hit) => out.extend([f64::from(hit.face.unwrap_or(0)), hit.point[1], hit.normal[0], hit.normal[1], hit.normal[2]]),
                None => out.extend([-1.0, 0.0, 0.0, 0.0, 0.0]),
            }
        }
        Ok(out)
    }
}

/// Flat order of the settings array (`SETTINGS_LAYOUT`), for the host packer to check against.
#[wasm_bindgen]
pub fn support_settings_layout() -> Vec<String> {
    support_settings::SETTINGS_LAYOUT.iter().map(|name| (*name).to_string()).collect()
}


/// The voxel remesh cache's `[hits, misses]` since the module loaded: tests prove a rebuild reused it.
#[wasm_bindgen]
pub fn remesh_cache_stats() -> Vec<u32> {
    let (hits, misses) = mixo_geometry_core::supports::remesh::cache_stats();
    vec![hits, misses]
}
