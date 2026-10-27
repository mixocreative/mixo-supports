//! The bounded repair runner: builds, checks the finished mesh exactly, and repairs within the
//! policy's budget. Policy-free: the steps and their order are fixed, the data (alternates, budget,
//! structure flags) come from the `PolicyResult`.

use super::enrich::review_components;
use super::{Fallback, empty_built};
use crate::supports::build::{BuildMode, BuiltSupports, HostChoices, LandingSource, build_supports};
use crate::supports::error::BuildError;
use crate::supports::parts::column::ColumnContact;
use crate::supports::parts::model::Model;
use crate::supports::policy::{Candidate, CandidateId, Origin, PolicyResult};
use crate::supports::contact_id::position_id;
use crate::supports::safety::clearance::{StructurePart, crossing_automatic_body_contacts, crossing_structure_parts};
use crate::supports::safety::conflicts::SupportMesh;
use crate::supports::safety::index::CollisionIndex;
use crate::supports::settings::SupportSettings;
use std::collections::HashSet;

pub struct Run<'a> {
    pub settings: &'a SupportSettings,
    pub mode: BuildMode,
    pub model: Option<&'a Model<'a>>,
    pub host: &'a HostChoices<'a>,
    pub index: Option<&'a CollisionIndex<'a>>,
    pub policy: &'a PolicyResult,
    pub expired: &'a dyn Fn() -> bool,
}

#[derive(Clone)]
struct Slot {
    contact: ColumnContact,
    /// The policy candidate this contact reproduces (alternates are keyed by it).
    candidate: Option<usize>,
    /// The candidate the contact currently stands for (its own, or the alternate it was moved to).
    ring_key: Option<CandidateId>,
}

pub struct Outcome {
    pub built: BuiltSupports,
    pub contacts: Vec<ColumnContact>,
    pub ring_keys: Vec<Option<CandidateId>>,
    pub dropped: Vec<String>,
    pub fallback: Vec<Fallback>,
    pub trials: u32,
    pub settings: SupportSettings,
}

impl Outcome {
    pub fn push_dropped(&mut self, id: String) {
        if !self.dropped.contains(&id) {
            self.dropped.push(id);
        }
    }
}

/// Trials the repair keeps back for leaving crossing contacts out and the last all-manual rebuild.
const FAILSAFE_TRIALS: u32 = 3;

/// Insertion-ordered set of IDs (the order contacts were left out is reported).
#[derive(Default)]
struct Ids {
    list: Vec<String>,
    seen: HashSet<String>,
}

impl Ids {
    fn of(ids: Vec<String>) -> Self {
        let mut out = Self::default();
        out.extend(ids);
        out
    }
    fn add(&mut self, id: String) {
        if self.seen.insert(id.clone()) {
            self.list.push(id);
        }
    }
    fn extend(&mut self, ids: impl IntoIterator<Item = String>) {
        for id in ids {
            self.add(id);
        }
    }
    fn contains(&self, id: &str) -> bool {
        self.seen.contains(id)
    }
}

fn id_of(slot: &Slot) -> &str {
    &slot.contact.candidate.id.0
}

fn is_auto(slot: &Slot) -> bool {
    slot.contact.candidate.origin != Origin::Manual
}

fn build(run: &Run, slots: &[Slot], settings: &SupportSettings) -> Result<BuiltSupports, BuildError> {
    if slots.is_empty() {
        return Ok(empty_built());
    }
    let contacts: Vec<ColumnContact> = slots.iter().map(|s| s.contact.clone()).collect();
    let source = if run.model.is_some() { LandingSource::Target } else { LandingSource::Model };
    build_supports(&contacts, settings, run.mode, run.model, source, run.host)
}

fn ids(built: &BuiltSupports, slots: &[Slot]) -> Vec<String> {
    built.dropped.iter().map(|&k| id_of(&slots[k as usize]).to_string()).collect()
}

fn mesh(built: &BuiltSupports) -> SupportMesh<'_> {
    SupportMesh { positions: &built.positions, indices: &built.indices, components: &built.components }
}

/// IDs (sorted) of the automatic contacts whose pillar body crosses the model.
fn crossing_auto(run: &Run, built: &BuiltSupports, slots: &[Slot], among: &dyn Fn(&str) -> bool) -> Vec<String> {
    let Some(index) = run.index else { return Vec::new() };
    let automatic = |k: u32| is_auto(&slots[k as usize]) && among(id_of(&slots[k as usize]));
    let mut found: Vec<String> = crossing_automatic_body_contacts(index, &mesh(built), &automatic, run.expired).into_iter().map(|k| id_of(&slots[k as usize]).to_string()).collect();
    found.sort();
    found.dedup();
    found
}

fn crossing_structures(run: &Run, built: &BuiltSupports, slots: &[Slot], settings: &SupportSettings) -> Vec<StructurePart> {
    let Some(index) = run.index else { return Vec::new() };
    let contacts: Vec<ColumnContact> = slots.iter().map(|s| s.contact.clone()).collect();
    let components = review_components(index, &contacts, built);
    let view = SupportMesh { positions: &built.positions, indices: &built.indices, components: &components };
    crossing_structure_parts(index, &view, settings, run.expired)
}

fn spend(trials: &mut u32, budget: u32) -> bool {
    if *trials >= budget {
        return false;
    }
    *trials += 1;
    true
}

/// Moves each crossing automatic contact to the next alternate its candidate offers; true when any moved.
fn move_to_alternates(run: &Run, slots: &mut [Slot], crossing: &[String], next: &mut Vec<usize>) -> bool {
    let mut moved = false;
    for id in crossing {
        let Some(k) = slots.iter().position(|s| id_of(s) == id) else { continue };
        let Some(candidate) = slots[k].candidate else { continue };
        let key = &run.policy.candidates[candidate].id;
        let Some((_, options)) = run.policy.alternates.iter().find(|(owner, _)| owner == key) else { continue };
        if next.len() <= k {
            next.resize(k + 1, 0);
        }
        let Some(alternate) = options.get(next[k]) else { continue };
        next[k] += 1;
        let Candidate { point, normal, source_face, id: alt_id, .. } = alternate.clone();
        let contact = &mut slots[k].contact;
        contact.candidate = Candidate { id: CandidateId(position_id(point)), source_face, point, normal, origin: Origin::Auto };
        contact.landing = None;
        slots[k].ring_key = Some(alt_id);
        moved = true;
    }
    moved
}

pub fn run(run: &Run, permitted: super::permit::Permitted) -> Result<Outcome, BuildError> {
    let mut slots: Vec<Slot> = permitted
        .contacts
        .into_iter()
        .zip(permitted.candidate_of)
        .map(|(contact, candidate)| Slot { ring_key: candidate.map(|k| run.policy.candidates[k].id.clone()), contact, candidate })
        .collect();
    let original_auto: Vec<String> = slots.iter().filter(|s| is_auto(s)).map(|s| id_of(s).to_string()).collect();
    let budget = run.policy.repair_budget;
    let repairing = budget > 0 && run.index.is_some();
    let mut effective = run.settings.clone();
    let mut trials = 0;
    let mut fallback: Vec<Fallback> = Vec::new();
    let mut built = build(run, &slots, &effective)?;
    let mut mesh_dropped = ids(&built, &slots);

    if repairing {
        // A tree or brace cannot be assigned to one contact (a trunk may serve many): switch off only
        // the unsafe structure, rebuild, keep the approved contacts.
        if effective.scatter_auto_tree && !(run.expired)() && crossing_structures(run, &built, &slots, &effective).iter().any(|p| matches!(p, StructurePart::TreeBranch | StructurePart::TreeTrunk)) && spend(&mut trials, budget) {
            effective.scatter_auto_tree = false;
            fallback.push(Fallback::Tree);
            built = build(run, &slots, &effective)?;
            mesh_dropped = ids(&built, &slots);
        }
        if effective.truss_enabled && !(run.expired)() && crossing_structures(run, &built, &slots, &effective).contains(&StructurePart::Brace) && spend(&mut trials, budget) {
            effective.truss_enabled = false;
            fallback.push(Fallback::Brace);
            built = build(run, &slots, &effective)?;
            mesh_dropped = ids(&built, &slots);
        }
        if slots.iter().any(is_auto) && !(run.expired)() {
            let mut crossing = crossing_auto(run, &built, &slots, &|_| true);
            // The policy's alternates first: a crossing contact may move, one rebuild per round.
            let mut next = Vec::new();
            // Three trials stay reserved for the fail-safe steps below.
            while !crossing.is_empty() && !run.policy.alternates.is_empty() && !(run.expired)() && trials + FAILSAFE_TRIALS < budget {
                if !move_to_alternates(run, &mut slots, &crossing, &mut next) {
                    break;
                }
                spend(&mut trials, budget);
                built = build(run, &slots, &effective)?;
                mesh_dropped = ids(&built, &slots);
                crossing = crossing_auto(run, &built, &slots, &|_| true);
            }
            if !crossing.is_empty() && trials < budget {
                trials += 1;
                let mut blocked = Ids::of(crossing);
                let mut dropped = Ids::of(mesh_dropped.clone());
                let automatic: Vec<String> = slots.iter().filter(|s| is_auto(s)).map(|s| id_of(s).to_string()).collect();
                slots.retain(|s| !blocked.contains(id_of(s)));
                built = build(run, &slots, &effective)?;
                mesh_dropped = ids(&built, &slots);
                dropped.extend(mesh_dropped.clone());
                // A changed tree/brace layout can expose another shaft. Bound the rebuild cost and refuse
                // all remaining automatic supports if that happens rather than returning a crossing body.
                let still: Vec<String> = automatic.iter().filter(|id| !blocked.contains(id)).cloned().collect();
                let remaining = crossing_auto(run, &built, &slots, &|id| still.iter().any(|s| s == id));
                if !remaining.is_empty() {
                    trials += 1;
                    blocked.extend(automatic);
                    slots.retain(|s| !is_auto(s));
                    built = build(run, &slots, &effective)?;
                    mesh_dropped = ids(&built, &slots);
                }
                let mut all = dropped;
                all.extend(mesh_dropped.clone());
                all.extend(blocked.list.clone());
                mesh_dropped = all.list;
            }
        }
        if !(run.expired)() && !crossing_structures(run, &built, &slots, &effective).is_empty() && trials < budget {
            // Rebuilding after a pillar omission can rearrange a tree or brace. Do not keep any
            // automatic structure if the bounded fallback still intersects the model.
            trials += 1;
            let mut omitted = Ids::of(mesh_dropped.clone());
            omitted.extend(original_auto.iter().cloned());
            slots.retain(|s| !is_auto(s));
            effective.scatter_auto_tree = false;
            effective.truss_enabled = false;
            built = build(run, &slots, &effective)?;
            let mut all = Ids::of(ids(&built, &slots));
            all.extend(omitted.list);
            mesh_dropped = all.list;
            for f in [Fallback::Tree, Fallback::Brace] {
                if !fallback.contains(&f) {
                    fallback.push(f);
                }
            }
        }
    }
    Ok(Outcome {
        contacts: slots.iter().map(|s| s.contact.clone()).collect(),
        ring_keys: slots.iter().map(|s| s.ring_key.clone()).collect(),
        built,
        dropped: mesh_dropped,
        fallback,
        trials,
        settings: effective,
    })
}
