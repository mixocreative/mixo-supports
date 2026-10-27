//! WASM bindings of the shared safety engine (U7): `generate` runs the whole support pipeline for a
//! `PolicyResult` (permit, build, exact body check, bounded repair, island and ring verdicts), and
//! `check_supports` is the support check. A policy crosses the boundary as data in a `PolicyData`
//! (no callback): the host fills it from the policy it produced and passes it to `generate`.

use super::{GeometrySession, build_error, coded_error, mesh_error};
use mixo_geometry_core::supports::build::BuildMode;
use mixo_geometry_core::supports::check::{CheckSettings, ProblemKind, check_supports};
use mixo_geometry_core::supports::flat::{self as support_flat, NO_CONTACT};
use mixo_geometry_core::supports::generate::{Fallback, GenerateInput, IslandStatus, IslandVerdict, generate};
use mixo_geometry_core::supports::parts::model as support_model;
use mixo_geometry_core::supports::policy::{AllowedStructures, AreaStamp, AutomaticRule, Candidate, CandidateId, FaceMask, LandingRule, Origin, PolicyResult, Ring};
use mixo_geometry_core::supports::safety::clearance::{IssueOrigin, Status};
use mixo_geometry_core::supports::zones::decode_zones;
use mixo_geometry_core::supports::{flat, settings as support_settings};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

/// Candidate / alternate rows: point xyz, normal xyz, source face (-1 none).
pub const CANDIDATE_STRIDE: usize = 7;
/// Stamp rows: centre xyz, radius, normal xyz, allow (0/1).
pub const STAMP_STRIDE: usize = 8;
/// Issue rows (u32): contact index (`NO_CONTACT` structural), part, model face, blocked (0/1), origin (0 auto, 1 manual, 2 structural).
pub const ISSUE_STRIDE: usize = 5;

/// The policy of a unit as data: what `PolicyResult` holds, in typed arrays.
#[wasm_bindgen]
pub struct PolicyData {
    result: PolicyResult,
}

fn rows(values: &[f64], stride: usize) -> Result<std::slice::ChunksExact<'_, f64>, JsValue> {
    if values.len() % stride != 0 || values.iter().any(|v| !v.is_finite()) {
        return Err(coded_error("BAD_INPUT"));
    }
    Ok(values.chunks_exact(stride))
}

fn candidates_of(ids: &[String], values: &[f64], origin: Origin) -> Result<Vec<Candidate>, JsValue> {
    let rows = rows(values, CANDIDATE_STRIDE)?;
    if rows.len() != ids.len() {
        return Err(coded_error("BAD_INPUT"));
    }
    Ok(ids
        .iter()
        .zip(rows)
        .map(|(id, r)| Candidate { id: CandidateId(id.clone()), source_face: (r[6] >= 0.0).then_some(r[6] as u32), point: [r[0], r[1], r[2]], normal: [r[3], r[4], r[5]], origin })
        .collect())
}

#[wasm_bindgen]
impl PolicyData {
    /// `automatic`: 0 every contact as given, 1 only contacts that reproduce a candidate.
    /// `landing_rule`: 0 unrestricted, 1 approved faces (`set_permitted_faces` + stamps).
    #[wasm_bindgen(constructor)]
    pub fn new(repair_budget: u32, automatic: u32, landing_rule: u32) -> Result<PolicyData, JsValue> {
        let mut result = PolicyResult::plain(FaceMask::new(0), Vec::new(), AllowedStructures { pillar: true, tree: true, brace: true, roof: true, cage: true, raft: true }, repair_budget);
        result.automatic = match automatic {
            0 => AutomaticRule::AsGiven,
            1 => AutomaticRule::MatchCandidates,
            _ => return Err(coded_error("BAD_INPUT")),
        };
        result.landing_rule = match landing_rule {
            0 => LandingRule::Unrestricted,
            1 => LandingRule::ApprovedFaces { stamps: Vec::new() },
            _ => return Err(coded_error("BAD_INPUT")),
        };
        Ok(PolicyData { result })
    }

    /// pillar, tree, brace, roof, cage, raft as 0/1.
    pub fn set_structures(&mut self, flags: &[u8]) -> Result<(), JsValue> {
        let [pillar, tree, brace, roof, cage, raft] = flags else { return Err(coded_error("BAD_INPUT")) };
        self.result.structures = AllowedStructures { pillar: *pillar != 0, tree: *tree != 0, brace: *brace != 0, roof: *roof != 0, cage: *cage != 0, raft: *raft != 0 };
        Ok(())
    }

    /// One 0/1 byte per source face.
    pub fn set_permitted_faces(&mut self, mask: &[u8]) {
        let mut faces = FaceMask::new(mask.len());
        for (face, &flag) in mask.iter().enumerate() {
            faces.set(face, flag != 0);
        }
        self.result.permitted_faces = faces;
    }

    /// Area edits applied at a landing point (`STAMP_STRIDE` f64 each, in order).
    pub fn set_stamps(&mut self, values: &[f64]) -> Result<(), JsValue> {
        let stamps: Vec<AreaStamp> = rows(values, STAMP_STRIDE)?.map(|r| AreaStamp { center: [r[0], r[1], r[2]], radius: r[3], normal: [r[4], r[5], r[6]], allow: r[7] != 0.0 }).collect();
        if matches!(self.result.landing_rule, LandingRule::ApprovedFaces { .. }) {
            self.result.landing_rule = LandingRule::ApprovedFaces { stamps };
        }
        Ok(())
    }

    pub fn set_candidates(&mut self, ids: Vec<String>, values: &[f64]) -> Result<(), JsValue> {
        self.result.candidates = candidates_of(&ids, values, Origin::Auto)?;
        Ok(())
    }

    /// Repair options in trial order: `owners[k]` is the candidate ID alternate `k` stands in for.
    pub fn set_alternates(&mut self, owners: Vec<String>, ids: Vec<String>, values: &[f64]) -> Result<(), JsValue> {
        if owners.len() != ids.len() {
            return Err(coded_error("BAD_INPUT"));
        }
        let options = candidates_of(&ids, values, Origin::Auto)?;
        let mut grouped: Vec<(CandidateId, Vec<Candidate>)> = Vec::new();
        for (owner, option) in owners.into_iter().zip(options) {
            match grouped.iter_mut().find(|(id, _)| id.0 == owner) {
                Some((_, list)) => list.push(option),
                None => grouped.push((CandidateId(owner), vec![option])),
            }
        }
        self.result.alternates = grouped;
        Ok(())
    }

    /// A contact ring: `arcs` is one arclength (mm) per candidate in `candidate_ids`.
    pub fn add_ring(&mut self, perimeter_mm: f64, spacing_mm: f64, candidate_ids: Vec<String>, arcs: &[f64]) -> Result<(), JsValue> {
        if candidate_ids.len() != arcs.len() || !perimeter_mm.is_finite() || !spacing_mm.is_finite() || arcs.iter().any(|a| !a.is_finite()) {
            return Err(coded_error("BAD_INPUT"));
        }
        self.result.rings.push(Ring { perimeter_mm, spacing_mm, arcs: candidate_ids.into_iter().map(CandidateId).zip(arcs.iter().copied()).collect() });
        Ok(())
    }
}

/// The result of `generate`: the support mesh arrays and tag tables (layout in `supports::flat`, the
/// tags index into `take_contact_ids`), what was left out, and the verdicts.
#[wasm_bindgen]
pub struct Generation {
    positions: Vec<f32>,
    indices: Vec<u32>,
    tags: Vec<u32>,
    reach: Vec<f64>,
    intents: Vec<f64>,
    contact_ids: Vec<String>,
    dropped: Vec<String>,
    dropped_by_zones: Vec<String>,
    fallback: Vec<u8>,
    status: u32,
    reason: String,
    issues: Vec<u32>,
    island_heights: Vec<f64>,
    island_vertices: Vec<u32>,
    island_status: Vec<u8>,
    island_reason: String,
    rings: Vec<f64>,
    trials: u32,
    revision: u32,
}

#[wasm_bindgen]
impl Generation {
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
    pub fn take_contact_ids(&mut self) -> Vec<String> {
        std::mem::take(&mut self.contact_ids)
    }
    pub fn take_dropped(&mut self) -> Vec<String> {
        std::mem::take(&mut self.dropped)
    }
    pub fn take_dropped_by_zones(&mut self) -> Vec<String> {
        std::mem::take(&mut self.dropped_by_zones)
    }
    /// Structures the repair switched off: 1 tree, 2 brace.
    pub fn take_fallback(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.fallback)
    }
    /// The request revision, echoed so the host can drop a result that is not the newest.
    pub fn revision(&self) -> u32 {
        self.revision
    }
    /// 0 clear, 1 blocked, 2 inconclusive.
    pub fn status(&self) -> u32 {
        self.status
    }
    pub fn reason(&self) -> String {
        self.reason.clone()
    }
    /// `ISSUE_STRIDE` u32 per crossing of the final mesh.
    pub fn take_issues(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.issues)
    }
    pub fn take_island_heights(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.island_heights)
    }
    pub fn take_island_vertices(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.island_vertices)
    }
    /// Per island: 0 resolved, 1 unresolved, 2 resolved only through manual support.
    pub fn take_island_status(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.island_status)
    }
    /// Non-empty when the islands could not be judged (no island is then called resolved).
    pub fn island_reason(&self) -> String {
        self.island_reason.clone()
    }
    /// Per ring: perimeter, retained contacts, largest gap, review gap, needs review (0/1).
    pub fn take_rings(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.rings)
    }
    pub fn trials(&self) -> u32 {
        self.trials
    }
}

#[wasm_bindgen]
impl GeometrySession {
    /// The support pipeline for a plate-space model: `contacts` and `shapes` as `build_supports`,
    /// `policy` the data of the unit's policy. `timeout_ms` > 0 ends the repair and checks early with
    /// an inconclusive verdict (never a clear one) once that much time has passed.
    pub fn generate(
        &mut self,
        model: u32,
        ids: Vec<String>,
        contacts: &[f64],
        shapes: &[f64],
        settings: &[f64],
        mode: u32,
        label_text: &str,
        zones: &[f64],
        policy: &PolicyData,
        timeout_ms: f64,
        revision: u32,
    ) -> Result<Generation, JsValue> {
        let settings = support_settings::SupportSettings::from_slice(settings).map_err(build_error)?;
        let contacts = flat::decode_contacts(&ids, contacts, shapes, &settings.shape).map_err(build_error)?;
        let mode = match mode {
            0 => BuildMode::Preview,
            1 => BuildMode::Export,
            _ => return Err(coded_error("BAD_INPUT")),
        };
        let zones = decode_zones(zones).ok_or_else(|| coded_error("BAD_INPUT"))?;
        self.store.ensure_pick_index(model).map_err(mesh_error)?;
        let (positions, indices, bvh) = self.store.pick_view(model).map_err(mesh_error)?;
        let view = support_model::Model::new(positions, indices, bvh);
        if policy.result.permitted_faces.len() != 0 && policy.result.permitted_faces.len() != view.face_count() {
            return Err(coded_error("BAD_INPUT"));
        }
        let started = if timeout_ms > 0.0 { js_sys::Date::now() } else { 0.0 };
        let expired = move || timeout_ms > 0.0 && js_sys::Date::now() - started > timeout_ms;
        let out = generate(GenerateInput { contacts, settings: &settings, mode, model: Some(&view), label_text, zones: &zones, policy: &policy.result, expired: &expired }).map_err(build_error)?;
        let table = support_flat::encode_components(&out.built);
        let mut issues = Vec::new();
        for issue in &out.verdict.issues {
            issues.extend([
                issue.contact.unwrap_or(NO_CONTACT),
                issue.part as u32,
                issue.model_face,
                u32::from(issue.blocked),
                match issue.origin {
                    IssueOrigin::Auto => 0,
                    IssueOrigin::Manual => 1,
                    IssueOrigin::Structural => 2,
                },
            ]);
        }
        debug_assert!(issues.len() % ISSUE_STRIDE == 0);
        let (mut heights, mut vertices, mut status, mut island_reason) = (Vec::new(), Vec::new(), Vec::new(), String::new());
        match &out.islands {
            IslandVerdict::Ok(islands) => {
                for island in islands {
                    heights.push(island.height);
                    vertices.push(island.vertex);
                    status.push(match (island.status, island.manual_only) {
                        (IslandStatus::Resolved, false) => 0,
                        (IslandStatus::Unresolved, _) => 1,
                        (IslandStatus::Resolved, true) => 2,
                    });
                }
            }
            IslandVerdict::Inconclusive(reason) => island_reason = (*reason).to_string(),
        }
        Ok(Generation {
            positions: out.built.positions,
            indices: out.built.indices,
            tags: table.tags,
            reach: table.reach,
            intents: table.intents,
            contact_ids: out.contact_ids,
            dropped: out.dropped,
            dropped_by_zones: out.dropped_by_zones,
            fallback: out.fallback.iter().map(|f| if *f == Fallback::Tree { 1 } else { 2 }).collect(),
            status: match out.verdict.status {
                Status::Clear => 0,
                Status::Blocked => 1,
                Status::Inconclusive => 2,
            },
            reason: out.verdict.reason.unwrap_or_default().to_string(),
            issues,
            island_heights: heights,
            island_vertices: vertices,
            island_status: status,
            island_reason,
            rings: out.rings.iter().flat_map(|r| [r.perimeter_mm, f64::from(r.retained), r.max_gap_mm, r.review_gap_mm, f64::from(u8::from(r.needs_review))]).collect(),
            trials: out.trials,
            revision,
        })
    }
}

/// Spots the contacts leave unsupported: kind (0 island, 1 overhang), position xyz, area.
#[wasm_bindgen]
pub struct SupportProblems {
    kinds: Vec<u8>,
    positions: Vec<f64>,
    areas: Vec<f64>,
}

#[wasm_bindgen]
impl SupportProblems {
    pub fn take_kinds(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.kinds)
    }
    pub fn take_positions(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.positions)
    }
    pub fn take_areas(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.areas)
    }
}

/// The support check over a mesh in the frame it is checked in (Y up): `contacts` are xyz triples.
#[wasm_bindgen]
pub fn check_support_problems(positions: &[f32], indices: &[u32], contacts: &[f64], overhang_angle_degrees: f64, spacing: f64) -> Result<SupportProblems, JsValue> {
    if positions.len() % 3 != 0 || indices.len() % 3 != 0 || contacts.len() % 3 != 0 || indices.iter().any(|&i| i as usize * 3 + 2 >= positions.len()) {
        return Err(coded_error("INVALID_LENGTH"));
    }
    if !overhang_angle_degrees.is_finite() || !spacing.is_finite() || spacing <= 0.0 || contacts.iter().any(|c| !c.is_finite()) {
        return Err(coded_error("BAD_INPUT"));
    }
    let points: Vec<[f64; 3]> = contacts.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
    let problems = check_supports(positions, indices, &points, &CheckSettings { overhang_angle_degrees, spacing });
    let mut out = SupportProblems { kinds: Vec::new(), positions: Vec::new(), areas: Vec::new() };
    for p in problems {
        out.kinds.push(u8::from(p.kind == ProblemKind::Overhang));
        out.positions.extend(p.position);
        out.areas.push(p.area);
    }
    Ok(out)
}

/// Length of a contour given as vertex-index pairs (a ring's perimeter).
#[wasm_bindgen]
pub fn contour_perimeter(positions: &[f32], edges: &[u32]) -> Result<f64, JsValue> {
    if edges.len() % 2 != 0 || positions.len() % 3 != 0 || edges.iter().any(|&v| v as usize * 3 + 2 >= positions.len()) {
        return Err(coded_error("INVALID_LENGTH"));
    }
    let at = |v: u32| {
        let o = v as usize * 3;
        [f64::from(positions[o]), f64::from(positions[o + 1]), f64::from(positions[o + 2])]
    };
    Ok(edges.chunks_exact(2).fold(0.0, |sum, e| {
        let (a, b) = (at(e[0]), at(e[1]));
        sum + mixo_geometry_core::supports::remesh::hypot3([a[0] - b[0], a[1] - b[1], a[2] - b[2]])
    }))
}
