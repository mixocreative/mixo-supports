//! `generic_policy`: the generic (non-dental) producer of a `PolicyResult`. The contacts are the
//! automatic placement (stored with the unit) minus the unit's deleted IDs, plus its manual
//! additions, minus the automatic ones a no-support zone covers; every face may carry a support, every
//! structure the settings ask for is allowed. Presets are validated numbers from the host
//! (`SupportSettings`); no mesh-building or landing code lives here (rule 1).

use super::placement::Source;
use crate::supports::edits::compose_contacts;
use crate::supports::parts::column::ContactKind;
use crate::supports::policy::{AllowedStructures, Candidate, CandidateId, FaceMask, Origin, PolicyResult};
use crate::supports::settings::{RoofMode, SupportSettings};
use crate::supports::zones::{ZoneStamp, zoned_at};

/// A stored contact of a unit (unit-local space).
#[derive(Clone, Debug, PartialEq)]
pub struct PolicyPoint {
    pub id: String,
    pub position: [f64; 3],
    pub normal: [f64; 3],
    pub source: Source,
}

pub struct GenericInput<'a> {
    /// Faces of the source mesh.
    pub face_count: usize,
    pub auto: &'a [PolicyPoint],
    pub manual: &'a [PolicyPoint],
    pub deleted: &'a [String],
    pub zones: &'a [ZoneStamp],
}

/// The result and, per candidate, the SLASG point class the build samples its neck normal by.
pub struct GenericPolicy {
    pub result: PolicyResult,
    pub kinds: Vec<ContactKind>,
}

/// SLASG point class of each placement source (manual points are untagged face points).
fn kind_of(source: Source) -> ContactKind {
    match source {
        Source::Interior => ContactKind::Face,
        Source::PhysicalBoundary | Source::SharpRidge => ContactKind::Edge,
        Source::Island => ContactKind::Vertical,
    }
}

pub fn generic_policy(input: &GenericInput, settings: &SupportSettings) -> GenericPolicy {
    let auto_ids: Vec<&str> = input.auto.iter().map(|p| p.id.as_str()).collect();
    let mut candidates = Vec::new();
    let mut kinds = Vec::new();
    for (is_manual, k) in compose_contacts(&auto_ids, input.manual.len(), input.deleted) {
        let point = if is_manual { &input.manual[k] } else { &input.auto[k] };
        let origin = if point.id.starts_with("manual-") { Origin::Manual } else { Origin::Auto };
        // Manual contacts ignore zones and never join Auto Tree branches; a support that lands in a
        // zone is the build's call (it reports those contacts as dropped).
        if origin == Origin::Auto && zoned_at(input.zones, point.position, Some(point.normal)) {
            continue;
        }
        candidates.push(Candidate { id: CandidateId(point.id.clone()), source_face: None, point: point.position, normal: point.normal, origin });
        kinds.push(kind_of(point.source));
    }
    let mut permitted_faces = FaceMask::new(input.face_count);
    for face in 0..input.face_count {
        permitted_faces.set(face, true);
    }
    let structures = AllowedStructures {
        pillar: true,
        tree: settings.scatter_auto_tree,
        brace: settings.truss_enabled,
        roof: settings.roof_mode == RoofMode::Roof,
        cage: settings.roof_mode == RoofMode::Cage,
        raft: settings.raft_enabled,
    };
    GenericPolicy { result: PolicyResult::plain(permitted_faces, candidates, structures, 0), kinds }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::settings::default_values;

    fn point(id: &str, x: f64, source: Source) -> PolicyPoint {
        PolicyPoint { id: id.into(), position: [x, 5.0, 0.0], normal: [0.0, -1.0, 0.0], source }
    }

    #[test]
    fn composes_the_contacts_with_their_classes_and_leaves_zones_and_deletions_out() {
        let settings = SupportSettings::from_slice(&default_values()).unwrap();
        let auto = [point("auto-0_500_0", 0.0, Source::Interior), point("auto-100_500_0", 1.0, Source::Island), point("auto-200_500_0", 2.0, Source::SharpRidge)];
        let manual = [point("manual-1", 2.0, Source::Interior)];
        let zone = ZoneStamp { center: [2.0, 5.0, 0.0], normal: [0.0, -1.0, 0.0], radius: 0.5, paint: true };
        let policy = generic_policy(&GenericInput { face_count: 4, auto: &auto, manual: &manual, deleted: &["auto-0_500_0".into()], zones: &[zone] }, &settings);
        let ids: Vec<&str> = policy.result.candidates.iter().map(|c| c.id.0.as_str()).collect();
        assert_eq!(ids, vec!["auto-100_500_0", "manual-1"]);
        assert_eq!(policy.kinds, vec![ContactKind::Vertical, ContactKind::Face]);
        assert_eq!(policy.result.candidates[1].origin, Origin::Manual);
        assert_eq!(policy.result.permitted_faces.count(), 4);
        assert!(policy.result.structures.raft && !policy.result.structures.tree);
    }
}
