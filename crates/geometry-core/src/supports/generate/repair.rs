//! The bounded repair runner: builds, checks the finished mesh exactly, and repairs within the
//! policy's budget. Policy-free: the steps and their order are fixed, the data (alternates, budget,
//! structure flags) come from the `PolicyResult`.

use super::enrich::review_components;
use super::reaim::{AIMS, Aim, reaim};
use super::{Fallback, empty_built};
use crate::supports::build::{BuildMode, BuiltSupports, HostChoices, LandingSource, build_supports};
use crate::supports::error::BuildError;
use crate::supports::parts::column::ColumnContact;
use crate::supports::parts::model::Model;
use crate::supports::policy::{Candidate, CandidateId, Origin, PolicyResult};
use crate::supports::contact_id::position_id;
use crate::supports::safety::clearance::{StructurePart, crossing_automatic_body_contacts, crossing_automatic_neck_contacts, crossing_structure_parts};
use crate::supports::parts::tags::Component;
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
    /// Plate frame to unit-local (see `GenerateInput::local`).
    pub local: Option<&'a crate::core::matrix::Matrix4>,
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

/// Trials the repair keeps back for the fail-safe steps: leaving crossing contacts out, the
/// all-manual rebuild, and the graduated structure fallback's structures-off rebuild (D20). Its
/// later steps (the crossing automatic contacts out, then all of them) spend from what is left; with
/// no trial left the crossing is reported instead.
const FAILSAFE_TRIALS: u32 = 4;

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

/// A repair trial's rebuild: the build the next check starts from, so the per-build memo is dropped.
fn rebuild(run: &Run, slots: &[Slot], settings: &SupportSettings, memo: &mut Memo, step: &'static str, touched: usize) -> Result<BuiltSupports, BuildError> {
    let started = trace::now();
    let built = build(run, slots, settings)?;
    let same = trace::seen(&built);
    trace::trial(step, touched, trace::now() - started, same);
    *memo = Memo::default();
    Ok(built)
}

fn ids(built: &BuiltSupports, slots: &[Slot]) -> Vec<String> {
    built.dropped.iter().map(|&k| id_of(&slots[k as usize]).to_string()).collect()
}

fn mesh(built: &BuiltSupports) -> SupportMesh<'_> {
    SupportMesh { positions: &built.positions, indices: &built.indices, components: &built.components }
}

/// IDs (sorted) of the automatic contacts whose pillar body crosses the model.
fn crossing_pillars(run: &Run, built: &BuiltSupports, slots: &[Slot], among: &dyn Fn(&str) -> bool) -> Vec<String> {
    let Some(index) = run.index else { return Vec::new() };
    let automatic = |k: u32| is_auto(&slots[k as usize]) && among(id_of(&slots[k as usize]));
    let mut found: Vec<String> = trace::check(|| crossing_automatic_body_contacts(index, &mesh(built), &automatic, run.expired)).into_iter().map(|k| id_of(&slots[k as usize]).to_string()).collect();
    found.sort();
    found.dedup();
    found
}

/// What the queries on one `built` computed; dropped at every rebuild, so each runs once per build.
#[derive(Default)]
struct Memo {
    components: Option<Vec<Component>>,
    /// The neck query over every automatic contact (the restricted queries are not cached).
    necks: Option<Vec<String>>,
    structures: Option<Vec<StructurePart>>,
}

impl Memo {
    fn components(&mut self, index: &CollisionIndex, slots: &[Slot], built: &BuiltSupports) -> &[Component] {
        self.components.get_or_insert_with(|| {
            let contacts: Vec<ColumnContact> = slots.iter().map(|s| s.contact.clone()).collect();
            trace::check(|| review_components(index, &contacts, built))
        })
    }
}

fn query_necks(run: &Run, memo: &mut Memo, built: &BuiltSupports, slots: &[Slot], settings: &SupportSettings, among: &dyn Fn(&str) -> bool) -> Vec<String> {
    let Some(index) = run.index else { return Vec::new() };
    let view = SupportMesh { positions: &built.positions, indices: &built.indices, components: memo.components(index, slots, built) };
    let automatic = |k: u32| is_auto(&slots[k as usize]) && among(id_of(&slots[k as usize]));
    let mut found: Vec<String> = trace::check(|| crossing_automatic_neck_contacts(index, &view, settings, &automatic, run.expired)).into_iter().map(|k| id_of(&slots[k as usize]).to_string()).collect();
    found.sort();
    found.dedup();
    found
}

/// IDs (sorted) of the automatic contacts whose tip or neck crosses the model beyond its own reach.
fn crossing_necks(run: &Run, memo: &mut Memo, built: &BuiltSupports, slots: &[Slot], settings: &SupportSettings) -> Vec<String> {
    if let Some(found) = &memo.necks {
        return found.clone();
    }
    let found = query_necks(run, memo, built, slots, settings, &|_| true);
    memo.necks = Some(found.clone());
    found
}

/// IDs (sorted) of the automatic contacts whose pillar, tip or neck crosses the model; `among` limits the contacts judged.
fn crossing_auto(run: &Run, memo: &mut Memo, built: &BuiltSupports, slots: &[Slot], settings: &SupportSettings, among: Option<&dyn Fn(&str) -> bool>) -> Vec<String> {
    let mut found = crossing_pillars(run, built, slots, among.unwrap_or(&|_| true));
    found.extend(match among {
        None => crossing_necks(run, memo, built, slots, settings),
        Some(among) => query_necks(run, memo, built, slots, settings, among),
    });
    found.sort();
    found.dedup();
    found
}

/// Re-aims the necks of the listed contacts (`reaim`); how many changed.
fn reaim_necks(run: &Run, slots: &mut [Slot], crossing: &[String], aim: Aim) -> usize {
    let mut changed = 0;
    for slot in slots.iter_mut().filter(|s| crossing.iter().any(|id| id == id_of(s))) {
        changed += usize::from(reaim(run.model, &mut slot.contact, aim));
    }
    changed
}

fn crossing_structures(run: &Run, memo: &mut Memo, built: &BuiltSupports, slots: &[Slot], settings: &SupportSettings) -> Vec<StructurePart> {
    let Some(index) = run.index else { return Vec::new() };
    if let Some(found) = &memo.structures {
        return found.clone();
    }
    let view = SupportMesh { positions: &built.positions, indices: &built.indices, components: memo.components(index, slots, built) };
    let found = trace::check(|| crossing_structure_parts(index, &view, settings, run.expired));
    memo.structures = Some(found.clone());
    found
}

fn spend(trials: &mut u32, budget: u32) -> bool {
    if *trials >= budget {
        return false;
    }
    *trials += 1;
    true
}

/// Moves each crossing automatic contact to the next alternate its candidate offers; how many moved.
fn move_to_alternates(run: &Run, slots: &mut [Slot], crossing: &[String], next: &mut Vec<usize>) -> usize {
    let mut moved = 0;
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
        // Named from its unit-local point, as placed tips are, so neither a lift change nor a fresh
        // generate at another height renames it (D20).
        let local = run.local.map_or(point, |m| crate::core::matrix::apply_to_point(m, point[0], point[1], point[2]));
        contact.candidate = Candidate { id: CandidateId(position_id(local)), source_face, point, normal, origin: Origin::Auto };
        contact.landing = None;
        slots[k].ring_key = Some(alt_id);
        moved += 1;
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
    trace::seen(&built);
    let mut memo = Memo::default();
    let mut mesh_dropped = ids(&built, &slots);

    if repairing {
        // A tree or brace cannot be assigned to one contact (a trunk may serve many): switch off only
        // the unsafe structure, rebuild, keep the approved contacts.
        if effective.scatter_auto_tree && !(run.expired)() && crossing_structures(run, &mut memo, &built, &slots, &effective).iter().any(|p| matches!(p, StructurePart::TreeBranch | StructurePart::TreeTrunk)) && spend(&mut trials, budget) {
            effective.scatter_auto_tree = false;
            fallback.push(Fallback::Tree);
            built = rebuild(run, &slots, &effective, &mut memo, "tree-fallback", 0)?;
            mesh_dropped = ids(&built, &slots);
        }
        if effective.truss_enabled && !(run.expired)() && crossing_structures(run, &mut memo, &built, &slots, &effective).contains(&StructurePart::Brace) && spend(&mut trials, budget) {
            effective.truss_enabled = false;
            fallback.push(Fallback::Brace);
            built = rebuild(run, &slots, &effective, &mut memo, "brace-fallback", 0)?;
            mesh_dropped = ids(&built, &slots);
        }
        if slots.iter().any(is_auto) && !(run.expired)() {
            // A crossing tip is re-aimed first (its own face normal, then straight down), one
            // rebuild per aim, keeping the trials reserved for the fail-safe steps.
            for aim in AIMS {
                if (run.expired)() || trials + FAILSAFE_TRIALS >= budget {
                    break;
                }
                let necks = crossing_necks(run, &mut memo, &built, &slots, &effective);
                if necks.is_empty() {
                    break;
                }
                let touched = reaim_necks(run, &mut slots, &necks, aim);
                if touched > 0 {
                    spend(&mut trials, budget);
                    built = rebuild(run, &slots, &effective, &mut memo, if aim == Aim::Face { "reaim-normal" } else { "reaim-down" }, touched)?;
                    mesh_dropped = ids(&built, &slots);
                }
            }
            let mut crossing = crossing_auto(run, &mut memo, &built, &slots, &effective, None);
            // The policy's alternates first: a crossing contact may move, one rebuild per round.
            let mut next = Vec::new();
            // FAILSAFE_TRIALS stay reserved for the fail-safe steps below.
            while !crossing.is_empty() && !run.policy.alternates.is_empty() && !(run.expired)() && trials + FAILSAFE_TRIALS < budget {
                let moved = move_to_alternates(run, &mut slots, &crossing, &mut next);
                if moved == 0 {
                    break;
                }
                spend(&mut trials, budget);
                built = rebuild(run, &slots, &effective, &mut memo, "alternates", moved)?;
                mesh_dropped = ids(&built, &slots);
                crossing = crossing_auto(run, &mut memo, &built, &slots, &effective, None);
            }
            if !crossing.is_empty() && spend(&mut trials, budget) {
                let mut blocked = Ids::of(crossing);
                let mut dropped = Ids::of(mesh_dropped.clone());
                let automatic: Vec<String> = slots.iter().filter(|s| is_auto(s)).map(|s| id_of(s).to_string()).collect();
                slots.retain(|s| !blocked.contains(id_of(s)));
                built = rebuild(run, &slots, &effective, &mut memo, "leave-out", blocked.list.len())?;
                mesh_dropped = ids(&built, &slots);
                dropped.extend(mesh_dropped.clone());
                // A changed tree/brace layout can expose another shaft. Bound the rebuild cost and refuse
                // all remaining automatic supports if that happens rather than returning a crossing body.
                let still: Vec<String> = automatic.iter().filter(|id| !blocked.contains(id)).cloned().collect();
                let remaining = crossing_auto(run, &mut memo, &built, &slots, &effective, Some(&|id| still.iter().any(|s| s == id)));
                // Every rebuild counts against the budget; without one left the crossing is reported.
                if !remaining.is_empty() && spend(&mut trials, budget) {
                    let automatic_count = automatic.len();
                    blocked.extend(automatic);
                    slots.retain(|s| !is_auto(s));
                    built = rebuild(run, &slots, &effective, &mut memo, "all-manual", automatic_count)?;
                    mesh_dropped = ids(&built, &slots);
                }
                let mut all = dropped;
                all.extend(mesh_dropped.clone());
                all.extend(blocked.list.clone());
                mesh_dropped = all.list;
            }
        }
        if !(run.expired)() && !crossing_structures(run, &mut memo, &built, &slots, &effective).is_empty() && spend(&mut trials, budget) {
            // Graduated (D20): first Tree and Brace off, every contact kept. Only a structure that was on is reported.
            let was_on = [(Fallback::Tree, effective.scatter_auto_tree), (Fallback::Brace, effective.truss_enabled)];
            effective.scatter_auto_tree = false;
            effective.truss_enabled = false;
            built = rebuild(run, &slots, &effective, &mut memo, "structures-off", 0)?;
            // Contacts left out earlier stay out; this build's own drops replace the previous build's.
            let mut kept = Ids::of(mesh_dropped.iter().filter(|id| !slots.iter().any(|s| id_of(s) == id.as_str())).cloned().collect());
            kept.extend(ids(&built, &slots));
            mesh_dropped = kept.list;
            for (f, on) in was_on {
                if on && !fallback.contains(&f) {
                    fallback.push(f);
                }
            }
            // Automatic contacts that still cross are left out, as in the leave-out step (D20).
            let crossing = if (run.expired)() { Vec::new() } else { crossing_auto(run, &mut memo, &built, &slots, &effective, None) };
            if !crossing.is_empty() && spend(&mut trials, budget) {
                let blocked = Ids::of(crossing);
                slots.retain(|s| !blocked.contains(id_of(s)));
                built = rebuild(run, &slots, &effective, &mut memo, "structures-off-leave-out", blocked.list.len())?;
                let mut all = Ids::of(mesh_dropped.iter().filter(|id| !slots.iter().any(|s| id_of(s) == id.as_str())).cloned().collect());
                all.extend(ids(&built, &slots));
                all.extend(blocked.list);
                mesh_dropped = all.list;
            }
            // Only if a crossing remains after that are all the automatic contacts left out.
            let still = !(run.expired)() && (!crossing_structures(run, &mut memo, &built, &slots, &effective).is_empty() || !crossing_auto(run, &mut memo, &built, &slots, &effective, None).is_empty());
            if still && spend(&mut trials, budget) {
                let mut omitted = Ids::of(mesh_dropped.clone());
                omitted.extend(original_auto.iter().cloned());
                let touched = slots.iter().filter(|s| is_auto(s)).count();
                slots.retain(|s| !is_auto(s));
                built = rebuild(run, &slots, &effective, &mut memo, "structure-fallback", touched)?;
                let mut all = Ids::of(ids(&built, &slots));
                all.extend(omitted.list);
                mesh_dropped = all.list;
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

/// The trial log: which step spent each trial, how many contacts it touched and what the rebuild and
/// the checks leading to it cost. Test-only; the production build records nothing.
#[cfg(test)]
pub(crate) mod trace {
    use std::cell::RefCell;
    use std::time::Instant;

    #[derive(Clone, Debug)]
    pub struct Trial {
        pub step: &'static str,
        pub touched: usize,
        pub build_ms: f64,
        /// Check time since the previous rebuild (cached queries cost nothing).
        pub check_ms: f64,
        /// The rebuild produced exactly the mesh it started from (a trial that changed nothing).
        pub same: bool,
    }

    thread_local! {
        static LOG: RefCell<(Vec<Trial>, f64)> = const { RefCell::new((Vec::new(), 0.0)) };
        static LAST: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
        static EPOCH: Instant = Instant::now();
    }

    pub fn now() -> f64 {
        EPOCH.with(|e| e.elapsed().as_secs_f64() * 1000.0)
    }

    pub fn check<T>(f: impl FnOnce() -> T) -> T {
        let started = now();
        let out = f();
        let spent = now() - started;
        LOG.with(|l| l.borrow_mut().1 += spent);
        out
    }

    /// Whether `built` is the mesh seen last (then remembers it).
    pub fn seen(built: &super::BuiltSupports) -> bool {
        let hash = built.positions.iter().chain(&[built.positions.len() as f32]).fold(0xcbf29ce484222325u64, |h, p| (h ^ u64::from(p.to_bits())).wrapping_mul(0x100000001b3));
        LAST.with(|l| l.replace(hash) == hash)
    }

    pub fn trial(step: &'static str, touched: usize, build_ms: f64, same: bool) {
        LOG.with(|l| {
            let mut l = l.borrow_mut();
            let check_ms = std::mem::take(&mut l.1);
            l.0.push(Trial { step, touched, build_ms, check_ms, same });
        });
    }

    /// Takes the log of the trials since the last take and clears it.
    pub fn take() -> Vec<Trial> {
        LOG.with(|l| {
            let mut l = l.borrow_mut();
            l.1 = 0.0;
            std::mem::take(&mut l.0)
        })
    }
}

#[cfg(not(test))]
mod trace {
    pub fn now() -> f64 {
        0.0
    }
    pub fn check<T>(f: impl FnOnce() -> T) -> T {
        f()
    }
    pub fn seen(_built: &super::BuiltSupports) -> bool {
        false
    }
    pub fn trial(_step: &'static str, _touched: usize, _build_ms: f64, _same: bool) {}
}
