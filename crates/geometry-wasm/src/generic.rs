//! WASM bindings of the generic policy: automatic placement, the `generic_policy` producer of a
//! `PolicyResult` and the manual-edit bookkeeping.

use super::{GeometrySession, build_error, coded_error, mesh_error};
use mixo_geometry_core::generic::placement::{PlacementSettings, Source, generate_placement};
use mixo_geometry_core::generic::policy::{GenericInput, PolicyPoint, generic_policy};
use mixo_geometry_core::supports::contact_id::position_id;
use mixo_geometry_core::supports::edits::{self, EditPoint};
use mixo_geometry_core::supports::parts::column::ContactKind;
use mixo_geometry_core::supports::policy::Origin;
use mixo_geometry_core::supports::zones::{self, decode_zones};
use mixo_geometry_core::supports::settings as support_settings;
use std::collections::HashSet;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

fn source_code(source: Source) -> u8 {
    match source {
        Source::Interior => 0,
        Source::PhysicalBoundary => 1,
        Source::SharpRidge => 2,
        Source::Island => 3,
    }
}

fn source_of(code: u8) -> Source {
    match code {
        1 => Source::PhysicalBoundary,
        2 => Source::SharpRidge,
        3 => Source::Island,
        _ => Source::Interior,
    }
}

/// Order of the placement settings array: overhang angle, spacing, edge inset, ridge angle, islands
/// (0/1), downward faces (0/1), reinforce edges (0/1).
const PLACEMENT_LEN: usize = 7;

/// Automatic contacts: positions and normals (xyz f64), source codes (0 interior, 1 physical boundary,
/// 2 sharp ridge, 3 island), IDs, and the faces of each downward region.
#[wasm_bindgen]
pub struct GenericPlacement {
    positions: Vec<f64>,
    normals: Vec<f64>,
    sources: Vec<u8>,
    ids: Vec<String>,
    region_faces: Vec<u32>,
    region_starts: Vec<u32>,
}

#[wasm_bindgen]
impl GenericPlacement {
    pub fn take_positions(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.positions)
    }
    pub fn take_normals(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.normals)
    }
    pub fn take_sources(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.sources)
    }
    pub fn take_ids(&mut self) -> Vec<String> {
        std::mem::take(&mut self.ids)
    }
    pub fn take_region_faces(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.region_faces)
    }
    /// Start of each region in `region_faces`, plus the total as the last entry.
    pub fn take_region_starts(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.region_starts)
    }
}

/// The composed contacts of a unit as a `PolicyResult`: IDs, positions, normals (xyz f64), origin
/// (1 manual), point class (0 none, 1 face, 2 edge, 3 vertical) and the allowed structures
/// (pillar, tree, brace, roof, cage, raft as 0/1).
#[wasm_bindgen]
pub struct GenericPolicyResult {
    ids: Vec<String>,
    positions: Vec<f64>,
    normals: Vec<f64>,
    origins: Vec<u8>,
    kinds: Vec<u8>,
    structures: Vec<u8>,
    permitted_faces: u32,
}

#[wasm_bindgen]
impl GenericPolicyResult {
    pub fn take_ids(&mut self) -> Vec<String> {
        std::mem::take(&mut self.ids)
    }
    pub fn take_positions(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.positions)
    }
    pub fn take_normals(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.normals)
    }
    pub fn take_origins(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.origins)
    }
    pub fn take_kinds(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.kinds)
    }
    pub fn take_structures(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.structures)
    }
    pub fn permitted_faces(&self) -> u32 {
        self.permitted_faces
    }
}

/// Support mesh arrays and per-component tables (layout in `supports::flat`).
#[wasm_bindgen]
impl GeometrySession {
    /// Automatic contacts of a loaded model (already in the frame they are wanted in).
    pub fn generic_place(&mut self, model: u32, settings: &[f64]) -> Result<GenericPlacement, JsValue> {
        if settings.len() != PLACEMENT_LEN || settings.iter().any(|v| !v.is_finite()) {
            return Err(coded_error("BAD_INPUT"));
        }
        let s = PlacementSettings {
            overhang_angle_degrees: settings[0],
            spacing: settings[1],
            edge_inset: settings[2],
            sharp_edge_angle_degrees: settings[3],
            include_islands: settings[4] != 0.0,
            include_downward: settings[5] != 0.0,
            reinforce_edges: settings[6] != 0.0,
        };
        let (positions, indices) = self.store.mesh_arrays(model).map_err(mesh_error)?;
        let placement = generate_placement(positions, indices, &s).map_err(|_| coded_error("SETTING_OUT_OF_RANGE"))?;
        let mut out = GenericPlacement { positions: Vec::new(), normals: Vec::new(), sources: Vec::new(), ids: Vec::new(), region_faces: Vec::new(), region_starts: Vec::new() };
        for point in &placement.points {
            out.positions.extend(point.position);
            out.normals.extend(point.normal);
            out.sources.push(source_code(point.source));
            out.ids.push(point.id.clone());
        }
        for region in &placement.regions {
            out.region_starts.push(out.region_faces.len() as u32);
            out.region_faces.extend(region);
        }
        out.region_starts.push(out.region_faces.len() as u32);
        Ok(out)
    }

}

fn points_of(ids: &[String], positions: &[f64], normals: &[f64], sources: &[u8]) -> Result<Vec<PolicyPoint>, JsValue> {
    if positions.len() != ids.len() * 3 || normals.len() != ids.len() * 3 || sources.len() != ids.len() || positions.iter().chain(normals).any(|v| !v.is_finite()) {
        return Err(coded_error("BAD_INPUT"));
    }
    Ok(ids
        .iter()
        .enumerate()
        .map(|(k, id)| PolicyPoint {
            id: id.clone(),
            position: [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]],
            normal: [normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]],
            source: source_of(sources[k]),
        })
        .collect())
}

/// `generic_policy`: the contacts of a unit (unit-local space): automatic minus deleted and zoned,
/// plus manual. `face_count` is the source mesh's face count.
#[wasm_bindgen]
pub fn generic_policy_contacts(
    face_count: u32,
    settings: &[f64],
    auto_ids: Vec<String>,
    auto_positions: &[f64],
    auto_normals: &[f64],
    auto_sources: &[u8],
    manual_ids: Vec<String>,
    manual_positions: &[f64],
    manual_normals: &[f64],
    manual_sources: &[u8],
    deleted: Vec<String>,
    zones: &[f64],
) -> Result<GenericPolicyResult, JsValue> {
    let settings = support_settings::SupportSettings::from_slice(settings).map_err(build_error)?;
    let auto = points_of(&auto_ids, auto_positions, auto_normals, auto_sources)?;
    let manual = points_of(&manual_ids, manual_positions, manual_normals, manual_sources)?;
    let zones = decode_zones(zones).ok_or_else(|| coded_error("BAD_INPUT"))?;
    let policy = generic_policy(&GenericInput { face_count: face_count as usize, auto: &auto, manual: &manual, deleted: &deleted, zones: &zones }, &settings);
    let mut out = GenericPolicyResult { ids: Vec::new(), positions: Vec::new(), normals: Vec::new(), origins: Vec::new(), kinds: Vec::new(), structures: Vec::new(), permitted_faces: 0 };
    for (candidate, kind) in policy.result.candidates.iter().zip(&policy.kinds) {
        out.ids.push(candidate.id.0.clone());
        out.positions.extend(candidate.point);
        out.normals.extend(candidate.normal);
        out.origins.push(u8::from(candidate.origin == Origin::Manual));
        out.kinds.push(match kind {
            ContactKind::Unspecified => 0,
            ContactKind::Face => 1,
            ContactKind::Edge => 2,
            ContactKind::Vertical => 3,
        });
    }
    let s = policy.result.structures;
    out.structures = [s.pillar, s.tree, s.brace, s.roof, s.cage, s.raft].map(u8::from).to_vec();
    out.permitted_faces = policy.result.permitted_faces.count() as u32;
    Ok(out)
}

#[wasm_bindgen]
impl GeometrySession {
    /// The generic policy of a unit as a `PolicyHandle` for `generate`: its contacts (automatic
    /// minus deleted and zoned, plus manual; unit-local), every face of `model` permitted, the
    /// structures the settings ask for, report-only repair. Arguments as `generic_policy_contacts`.
    pub fn generic_policy(
        &self,
        model: u32,
        settings: &[f64],
        auto_ids: Vec<String>,
        auto_positions: &[f64],
        auto_normals: &[f64],
        auto_sources: &[u8],
        manual_ids: Vec<String>,
        manual_positions: &[f64],
        manual_normals: &[f64],
        manual_sources: &[u8],
        deleted: Vec<String>,
        zones: &[f64],
    ) -> Result<super::safety::PolicyHandle, JsValue> {
        let (_, indices) = self.store.mesh_arrays(model).map_err(mesh_error)?;
        let settings = support_settings::SupportSettings::from_slice(settings).map_err(build_error)?;
        let auto = points_of(&auto_ids, auto_positions, auto_normals, auto_sources)?;
        let manual = points_of(&manual_ids, manual_positions, manual_normals, manual_sources)?;
        let zones = decode_zones(zones).ok_or_else(|| coded_error("BAD_INPUT"))?;
        let input = GenericInput { face_count: indices.len() / 3, auto: &auto, manual: &manual, deleted: &deleted, zones: &zones };
        Ok(super::safety::PolicyHandle::new(generic_policy(&input, &settings).result))
    }
}

/// Whether `point` is zoned by the no-support `zones` (`ZONE_STRIDE` f64 each): the last stamp that
/// reaches it decides, and an empty `normal` skips the side test. The one place the host asks the
/// stamp rule (`AreaStamp::resolve`), e.g. whether a check finding lies in a zone.
#[wasm_bindgen]
pub fn zoned_at(zones: &[f64], point: &[f64], normal: &[f64]) -> Result<bool, JsValue> {
    let stamps = decode_zones(zones).ok_or_else(|| coded_error("INVALID_LENGTH"))?;
    let vec3 = |values: &[f64]| -> Result<[f64; 3], JsValue> {
        match values {
            [x, y, z] if values.iter().all(|v| v.is_finite()) => Ok([*x, *y, *z]),
            _ => Err(coded_error("INVALID_LENGTH")),
        }
    };
    let normal = if normal.is_empty() { None } else { Some(vec3(normal)?) };
    Ok(zones::zoned_at(&stamps, vec3(point)?, normal))
}

/// The ID each position encodes on the 0.01 mm grid (`auto-X_Y_Z`).
#[wasm_bindgen]
pub fn position_ids(positions: &[f64]) -> Result<Vec<String>, JsValue> {
    if positions.len() % 3 != 0 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(positions.chunks_exact(3).map(|p| position_id([p[0], p[1], p[2]])).collect())
}

fn edit_points(ids: &[String], positions: &[f64]) -> Result<Vec<EditPoint>, JsValue> {
    if positions.len() != ids.len() * 3 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(ids.iter().enumerate().map(|(k, id)| EditPoint { id: id.clone(), position: [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]] }).collect())
}

/// The deleted IDs, re-keyed to a fresh placement (`remap_deleted`).
#[wasm_bindgen]
pub fn remap_deleted_ids(deleted: Vec<String>, point_ids: Vec<String>, point_positions: &[f64], match_radius: f64) -> Result<Vec<String>, JsValue> {
    Ok(edits::remap_deleted(&deleted, &edit_points(&point_ids, point_positions)?, match_radius))
}

/// Removals that hide an automatic contact right now.
#[wasm_bindgen]
pub fn hiding_removal_ids(auto_ids: Vec<String>, deleted: Vec<String>) -> Vec<String> {
    let ids: Vec<&str> = auto_ids.iter().map(String::as_str).collect();
    edits::hiding_removals(&ids, &deleted)
}

/// Automatic contacts an old radius removal hid.
#[wasm_bindgen]
pub fn contacts_hidden_by_marker_ids(auto_ids: Vec<String>, auto_positions: &[f64], markers: Vec<String>, erase_radius: f64) -> Result<Vec<String>, JsValue> {
    Ok(edits::contacts_hidden_by_markers(&edit_points(&auto_ids, auto_positions)?, &markers, erase_radius))
}

/// IDs of stored automatic contacts re-derived from their positions (`rekeyPoints`).
#[wasm_bindgen]
pub fn rekey_contact_ids(ids: Vec<String>, positions: &[f64]) -> Result<Vec<String>, JsValue> {
    Ok(edits::rekey_ids(&edit_points(&ids, positions)?))
}

/// Result of `rekey_hand_work`: the re-keyed removals, the target of each per-support settings ID
/// (empty string = dropped) and four counts (removals kept / reset, settings kept / reset).
#[wasm_bindgen]
pub struct HandWork {
    deleted: Vec<String>,
    targets: Vec<String>,
    counts: Vec<u32>,
}

#[wasm_bindgen]
impl HandWork {
    pub fn take_deleted(&mut self) -> Vec<String> {
        std::mem::take(&mut self.deleted)
    }
    pub fn take_targets(&mut self) -> Vec<String> {
        std::mem::take(&mut self.targets)
    }
    pub fn take_counts(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.counts)
    }
}

#[wasm_bindgen]
pub fn rekey_hand_work(
    deleted: Vec<String>,
    override_ids: Vec<String>,
    manual_ids: Vec<String>,
    point_ids: Vec<String>,
    point_positions: &[f64],
    match_radius: f64,
) -> Result<HandWork, JsValue> {
    let manual: HashSet<String> = manual_ids.into_iter().collect();
    let work = edits::rekey_hand_work(&deleted, &override_ids, &manual, &edit_points(&point_ids, point_positions)?, match_radius);
    Ok(HandWork {
        deleted: work.deleted,
        targets: work.override_targets.into_iter().map(Option::unwrap_or_default).collect(),
        counts: vec![work.removals_kept as u32, work.removals_reset as u32, work.customised_kept as u32, work.customised_reset as u32],
    })
}
