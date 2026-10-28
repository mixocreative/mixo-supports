//! Body clearance: which built components cross the model and which only reach it on purpose. One
//! classifier for both policies. Ports of TS `dentalBodyClearance.ts` (crossing automatic pillars,
//! crossing structures) and the frozen `genericBodyClearance.ts` (full-mesh report); the dental
//! functions are the generic classifier with a component selection, not a separate pipeline.

use super::conflicts::{Conflict, SupportMesh, body_conflicts};
use super::index::CollisionIndex;
use super::reach::{ReachLimits, is_intentional_contact_reach};
use crate::supports::parts::tags::{BraceKey, Component, Part, StructureKind};
use crate::supports::policy::Origin;
use crate::supports::settings::{ContactShape, SupportSettings};
use std::collections::BTreeSet;

fn contact_radius(s: &SupportSettings) -> f64 {
    (if s.shape.contact_shape == ContactShape::Sphere { s.shape.touch_diameter } else { s.shape.point_diameter }) / 2.0
}

fn tip_depth(s: &SupportSettings) -> f64 {
    if s.shape.contact_shape == ContactShape::Sphere { s.shape.touch_depth } else { s.shape.point_depth }
}

/// How far a contact end may reach into the surface it was built for.
pub fn reach_limits(s: &SupportSettings) -> ReachLimits {
    ReachLimits {
        radius_mm: s.shape.neck_length + s.pillar_diameter / 2.0 + contact_radius(s),
        penetration_mm: tip_depth(s).max(0.0) + contact_radius(s) + 0.05,
        face_normal_dot_min: 0.8,
    }
}

/// Structures a fallback may switch off; order is the order of their names (`brace` < `tree-branch`).
/// A brace names its segment, so the repair can leave out just that one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum StructurePart {
    Brace(BraceKey),
    TreeBranch,
    TreeTrunk,
}

fn is_tree_neck(c: &Component) -> bool {
    c.tag.part == Part::Neck && c.tag.structure_kind == Some(StructureKind::Tree)
}

/// Contact indices (ascending) whose automatic pillar body crosses the model; the marked landing
/// tip of a pillar is exempt.
pub fn crossing_automatic_body_contacts(index: &CollisionIndex, supports: &SupportMesh, automatic: &dyn Fn(u32) -> bool, expired: &dyn Fn() -> bool) -> Vec<u32> {
    let select = |c: &Component| c.tag.part == Part::Pillar && c.tag.contact.is_some_and(automatic);
    let hits = body_conflicts(index, supports, &select, true, None, expired);
    hits.iter().filter_map(|h| supports.components[h.component].tag.contact).collect::<BTreeSet<_>>().into_iter().collect()
}

/// Contact indices (ascending) whose automatic tip or neck (not a tree's) crosses the model beyond
/// the tip's own reach, judged exactly as the verdict judges it. `supports` must carry the contact
/// intents of the review (`generate::enrich::review_components`).
pub fn crossing_automatic_neck_contacts(index: &CollisionIndex, supports: &SupportMesh, settings: &SupportSettings, automatic: &dyn Fn(u32) -> bool, expired: &dyn Fn() -> bool) -> Vec<u32> {
    let select = |c: &Component| matches!(c.tag.part, Part::Tip | Part::Neck) && c.tag.structure_kind.is_none() && c.tag.contact.is_some_and(automatic);
    let limits = reach_limits(settings);
    let allow = |hit: &Conflict| is_intentional_contact_reach(index, supports, hit, &limits);
    let hits = body_conflicts(index, supports, &select, false, Some(&allow), expired);
    hits.iter().filter_map(|h| supports.components[h.component].tag.contact).collect::<BTreeSet<_>>().into_iter().collect()
}

/// Crossing tree and brace components, for the conservative mode fallback. A tree branch or tree
/// neck may touch its own source surface on purpose.
pub fn crossing_structure_parts(index: &CollisionIndex, supports: &SupportMesh, settings: &SupportSettings, expired: &dyn Fn() -> bool) -> Vec<StructurePart> {
    let part = |c: &Component| matches!(c.tag.part, Part::TreeBranch | Part::TreeTrunk | Part::Brace) || is_tree_neck(c);
    if !supports.components.iter().any(part) {
        return Vec::new();
    }
    let limits = reach_limits(settings);
    let allow = |hit: &Conflict| {
        let c = &supports.components[hit.component];
        (c.tag.part == Part::TreeBranch || is_tree_neck(c)) && is_intentional_contact_reach(index, supports, hit, &limits)
    };
    let hits = body_conflicts(index, supports, &part, false, Some(&allow), expired);
    hits.iter()
        .map(|h| {
            let c = &supports.components[h.component];
            // A tree neck is switched off with the tree's branches.
            if is_tree_neck(c) || c.tag.part == Part::TreeBranch {
                StructurePart::TreeBranch
            } else if c.tag.part == Part::TreeTrunk {
                StructurePart::TreeTrunk
            } else {
                // Every brace is emitted with its key; the sentinel (no segment) can never be pruned, so
                // the repair would fall through to switching the braces off, not accept the crossing.
                StructurePart::Brace(c.tag.brace.unwrap_or([i32::MIN; 6]))
            }
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IssueOrigin {
    Auto,
    Manual,
    Structural,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Clear,
    Blocked,
    Inconclusive,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyIssue {
    pub part: Part,
    pub contact: Option<u32>,
    pub origin: IssueOrigin,
    pub model_face: u32,
    /// False: a contact end whose face identity is missing, so it cannot be judged (inconclusive).
    pub blocked: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BodyReport {
    pub status: Status,
    pub issues: Vec<BodyIssue>,
    pub reason: Option<&'static str>,
}

fn valid_supports(s: &SupportMesh) -> bool {
    if s.positions.len() % 3 != 0 || s.indices.len() % 3 != 0 || s.positions.iter().any(|v| !v.is_finite()) || s.indices.iter().any(|&v| v as usize >= s.positions.len() / 3) {
        return false;
    }
    let mut covered = 0u32;
    for c in s.components {
        if c.start != covered || c.count % 3 != 0 {
            return false;
        }
        covered += c.count;
    }
    covered as usize == s.indices.len()
}

/// Exact full-mesh body-clearance report; `Clear` means no body intersection, not print-stable. A
/// timeout is always `Inconclusive` (reason "timeout"), never `Clear` and never `Blocked`: a deadline
/// that expired means the scan may be partial, so even a crossing already found is kept only as detail.
pub fn review_body_clearance(index: &CollisionIndex, supports: &SupportMesh, settings: &SupportSettings, expired: &dyn Fn() -> bool) -> BodyReport {
    if !index.valid || !valid_supports(supports) {
        return BodyReport { status: Status::Inconclusive, issues: Vec::new(), reason: Some("invalid-geometry") };
    }
    let limits = reach_limits(settings);
    let allow = |hit: &Conflict| is_intentional_contact_reach(index, supports, hit, &limits);
    let hits = body_conflicts(index, supports, &|_| true, false, Some(&allow), expired);
    let issues: Vec<BodyIssue> = hits
        .iter()
        .map(|hit| {
            let c = &supports.components[hit.component];
            let uncertain = (matches!(c.tag.part, Part::Tip | Part::Neck | Part::TreeBranch) || (c.tag.part == Part::Pillar && c.tag.landing_reach.is_some()))
                && !c.tag.intents.iter().any(|i| i.face.is_some());
            BodyIssue {
                part: c.tag.part,
                contact: c.tag.contact,
                origin: match (c.tag.contact, c.tag.origin) {
                    (Some(_), Some(Origin::Manual)) => IssueOrigin::Manual,
                    (Some(_), _) => IssueOrigin::Auto,
                    _ => IssueOrigin::Structural,
                },
                model_face: hit.model_face as u32,
                blocked: !uncertain,
            }
        })
        .collect();
    let timed_out = expired();
    let status = if timed_out {
        Status::Inconclusive
    } else if issues.iter().any(|i| i.blocked) {
        Status::Blocked
    } else if !issues.is_empty() {
        Status::Inconclusive
    } else {
        Status::Clear
    };
    BodyReport { status, issues, reason: timed_out.then_some("timeout") }
}
