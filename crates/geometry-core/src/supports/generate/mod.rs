//! `generate`: one call that runs the whole support pipeline in Rust for either policy: permit the
//! contacts the `PolicyResult` allows, build, check the finished mesh exactly against the model, run
//! the bounded repair, and return the mesh with one verdict. A policy is data; nothing here knows
//! "dental". The repair is: switch off a crossing Tree or Brace, re-aim the neck of an automatic
//! contact whose tip crosses, try the policy's alternates for a crossing automatic contact (pillar
//! or tip), otherwise leave that contact out, and as the last bounded step build
//! the manual contacts alone. Manual contacts are never moved or deleted. Every rebuild is a trial
//! against `repair_budget`; a budget of 0 reports without repairing. A timeout is `Inconclusive`,
//! never `Clear`.

mod enrich;
mod islands;
mod permit;
mod reaim;
mod repair;

pub use islands::{Island, IslandStatus, IslandVerdict};
pub use permit::{chosen_settings, landing_allowed, permit, primary_source_face, same_primary};

use super::build::{BuildMode, BuiltSupports, HostChoices};
use super::error::BuildError;
use super::parts::column::ColumnContact;
use super::parts::landing::Landing;
use super::parts::model::Model;
use super::policy::{AllowedStructures, PolicyResult};
use super::safety::clearance::{BodyIssue, Status, review_body_clearance};
use super::safety::conflicts::SupportMesh;
use super::safety::index::CollisionIndex;
use super::safety::rings::{RingCoverage, ring_coverage};
use super::settings::{RoofMode, SupportSettings};
use super::policy::AreaStamp;
use islands::{IslandInput, island_verdict};

pub struct GenerateInput<'a> {
    pub contacts: Vec<ColumnContact>,
    pub settings: &'a SupportSettings,
    pub mode: BuildMode,
    /// The model in plate space; without one nothing can cross it and the verdict is `Clear`.
    pub model: Option<&'a Model<'a>>,
    pub label_text: &'a str,
    pub zones: &'a [AreaStamp],
    pub policy: &'a PolicyResult,
    /// Polled between steps; once true the remaining work is skipped and the verdict is inconclusive.
    pub expired: &'a dyn Fn() -> bool,
    /// The plate frame back to the unit-local frame (the inverse of the generation frame; `None`: the
    /// contacts are unit-local already). A repaired contact is named from its unit-local point (D20).
    pub local: Option<&'a crate::core::matrix::Matrix4>,
}

/// A structure the repair switched off because its built geometry crossed the model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fallback {
    Tree,
    Brace,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Verdict {
    pub status: Status,
    pub reason: Option<&'static str>,
    /// Every non-exempt crossing of the final mesh (empty for `Clear`).
    pub issues: Vec<BodyIssue>,
    /// True when a blocked crossing belongs to a part no contact owns (a tree trunk or a brace serves
    /// several contacts and records none), so every contact's island credit was withdrawn as the
    /// conservative reading. A crossing that names its contact withdraws only that contact's.
    pub unattributed_crossing: bool,
}

pub struct Generated {
    pub built: BuiltSupports,
    /// IDs of the contacts the final build used; component tags index into this list.
    pub contact_ids: Vec<String>,
    /// Automatic contacts left out (policy, landing rule, zones, repair), in the order they were left out.
    pub dropped: Vec<String>,
    pub dropped_by_zones: Vec<String>,
    pub fallback: Vec<Fallback>,
    pub verdict: Verdict,
    pub islands: IslandVerdict,
    pub rings: Vec<RingCoverage>,
    /// Rebuilds the repair spent.
    pub trials: u32,
}

/// The policy's structure flags as an upper bound on the settings.
pub fn limit_structures(settings: &SupportSettings, allowed: &AllowedStructures) -> SupportSettings {
    let mut s = settings.clone();
    s.scatter_auto_tree &= allowed.tree;
    s.truss_enabled &= allowed.brace;
    s.raft_enabled &= allowed.raft;
    if (s.roof_mode == RoofMode::Roof && !allowed.roof) || (s.roof_mode == RoofMode::Cage && !allowed.cage) {
        s.roof_mode = RoofMode::Off;
    }
    s
}

pub(crate) fn empty_built() -> BuiltSupports {
    BuiltSupports { positions: Vec::new(), indices: Vec::new(), components: Vec::new(), dropped: Vec::new(), dropped_by_zones: Vec::new(), grounds: Vec::new() }
}

pub fn generate(input: GenerateInput) -> Result<Generated, BuildError> {
    let GenerateInput { contacts, settings, mode, model, label_text, zones, policy, expired, local } = input;
    let settings = limit_structures(&chosen_settings(settings, policy), &policy.structures);
    let permitted = permit(contacts, policy);
    let rejected = permitted.rejected.clone();
    let allowed = model.and_then(|m| landing_allowed(m, policy));
    let rule: Option<&dyn Fn(&Landing) -> bool> = allowed.as_ref().map(|f| f as &dyn Fn(&Landing) -> bool);
    let host = HostChoices { label_text, zones, landing_allowed: rule };
    let index = model.map(|m| CollisionIndex::new(m.positions(), m.indices()));
    let run = repair::Run { settings: &settings, mode, model, host: &host, index: index.as_ref(), policy, expired, local };
    let mut outcome = repair::run(&run, permitted)?;
    // Contacts the policy never permitted are reported with the rest (after the build's own).
    for id in rejected {
        outcome.push_dropped(id);
    }
    let verdict = match &index {
        Some(index) => {
            let components = enrich::review_components(index, &outcome.contacts, &outcome.built);
            let mesh = SupportMesh { positions: &outcome.built.positions, indices: &outcome.built.indices, components: &components };
            let report = review_body_clearance(index, &mesh, &outcome.settings, expired);
            let unattributed_crossing = report.issues.iter().any(|i| i.blocked && i.contact.is_none());
            Verdict { status: report.status, reason: report.reason, issues: report.issues, unattributed_crossing }
        }
        None => Verdict { status: Status::Clear, reason: None, issues: Vec::new(), unattributed_crossing: false },
    };
    let mut verdict = verdict;
    // Only a policy that says it has an outside reports islands there; the generic one permits every face.
    let permitted_area = policy.islands_outside_permitted.then(|| |face: u32| policy.permitted_faces.get(face as usize));
    let islands = match model {
        Some(model) => {
            let blocked = withdrawn_contacts(&verdict.issues, outcome.contacts.len());
            island_verdict(IslandInput {
                positions: model.positions(),
                indices: model.indices(),
                contacts: &outcome.contacts,
                grounds: &outcome.built.grounds,
                verified: &|k| !blocked[k],
                cover_mm: outcome.settings.scatter_spacing,
                expired,
                permitted_face: permitted_area.as_ref().map(|f| f as &dyn Fn(u32) -> bool),
                plate_y: outcome.settings.plate_y,
            })
        }
        None => IslandVerdict::Ok(Vec::new()),
    };
    let (rings, ring_error) = rings_of(policy, &outcome);
    // A ring that cannot be measured is not "fully open" and not fine: the verdict cannot be clear.
    if let (Some(reason), Status::Clear) = (ring_error, verdict.status) {
        verdict.status = Status::Inconclusive;
        verdict.reason = Some(reason);
    }
    let contact_ids = outcome.contacts.iter().map(|c| c.candidate.id.0.clone()).collect();
    let dropped_by_zones = outcome.built.dropped_by_zones.iter().map(|&k| outcome.contacts[k as usize].candidate.id.0.clone()).collect();
    Ok(Generated { dropped: outcome.dropped, fallback: outcome.fallback, trials: outcome.trials, built: outcome.built, contact_ids, dropped_by_zones, verdict, islands, rings })
}

/// Contacts whose island credit a blocked crossing withdraws. A crossing that names its contact
/// un-verifies only that contact's support. One with no owner (a trunk or brace: the build records no
/// contact list for them) cannot be attributed to a subset, so it conservatively withdraws all;
/// `Verdict::unattributed_crossing` reports that.
fn withdrawn_contacts(issues: &[BodyIssue], count: usize) -> Vec<bool> {
    (0..count).map(|k| issues.iter().any(|i| i.blocked && (i.contact == Some(k as u32) || i.contact.is_none()))).collect()
}

/// Coverage of each policy ring from the built automatic contacts that reproduce its candidates, and
/// the reason of the first ring that could not be measured (that ring is left out of the list).
fn rings_of(policy: &PolicyResult, outcome: &repair::Outcome) -> (Vec<RingCoverage>, Option<&'static str>) {
    let mut built = vec![false; outcome.contacts.len()];
    for component in &outcome.built.components {
        if let Some(k) = component.tag.contact {
            built[k as usize] = true;
        }
    }
    let mut error = None;
    let mut rings = Vec::new();
    for ring in &policy.rings {
        let retained: Vec<f64> = (0..outcome.contacts.len())
            .filter(|&k| built[k] && outcome.ring_keys[k].is_some())
            .filter_map(|k| ring.arcs.iter().find(|(id, _)| Some(id) == outcome.ring_keys[k].as_ref()).map(|(_, arc)| *arc))
            .collect();
        match ring_coverage(ring.perimeter_mm, ring.spacing_mm, &retained) {
            Ok(coverage) => rings.push(coverage),
            Err(reason) => error = error.or(Some(reason)),
        }
    }
    (rings, error)
}

#[cfg(test)]
mod tests;
