//! The policy contract (docs/SHIP-PLAN.md, Contracts). A policy is data: it produces a
//! `PolicyResult` that the support engine consumes. No behavior lives here.

/// Bitset over the faces of the source mesh.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct FaceMask {
    words: Vec<u64>,
    len: usize,
}

impl FaceMask {
    pub fn new(len: usize) -> Self {
        Self { words: vec![0; len.div_ceil(64)], len }
    }
    pub fn len(&self) -> usize {
        self.len
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    /// Out-of-range faces are never permitted.
    pub fn get(&self, face: usize) -> bool {
        face < self.len && self.words[face / 64] >> (face % 64) & 1 == 1
    }
    /// Returns false (and changes nothing) when `face` is out of range.
    pub fn set(&mut self, face: usize, value: bool) -> bool {
        if face >= self.len {
            return false;
        }
        let bit = 1u64 << (face % 64);
        if value {
            self.words[face / 64] |= bit;
        } else {
            self.words[face / 64] &= !bit;
        }
        true
    }
    pub fn count(&self) -> usize {
        self.words.iter().map(|word| word.count_ones() as usize).sum()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    Auto,
    Manual,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CandidateId(pub String);

/// A primary contact: where a support touches the model.
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub id: CandidateId,
    pub source_face: Option<u32>,
    pub point: [f64; 3],
    /// Model surface normal at the point, pointing out of the model.
    pub normal: [f64; 3],
    pub origin: Origin,
}

/// Which support structures a policy allows (dental: roof and cage off).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AllowedStructures {
    pub pillar: bool,
    pub tree: bool,
    pub brace: bool,
    pub roof: bool,
    pub cage: bool,
    pub raft: bool,
}

/// One brush dab of a policy's area edit: a sphere on the surface, the normal it was painted on, and
/// whether it adds (`allow`) or removes the area. Stamps apply in order; the last one that reaches a
/// point wins.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AreaStamp {
    pub center: [f64; 3],
    pub radius: f64,
    pub normal: [f64; 3],
    pub allow: bool,
}

/// Where a support's secondary contact (a column or tree landing on the model) may land.
#[derive(Clone, Debug, PartialEq, Default)]
pub enum LandingRule {
    #[default]
    Unrestricted,
    /// Only on an upward-facing source face inside `permitted_faces` (a later `stamps` dab at the
    /// landing point can erase or restore it); an automatic support landing anywhere else is left out.
    ApprovedFaces { stamps: Vec<AreaStamp> },
}

/// Which automatic contacts the engine may build.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum AutomaticRule {
    /// Every contact the host passes (the generic policy: the candidates are the contacts).
    #[default]
    AsGiven,
    /// Only a contact that reproduces one of `candidates` (same spot within 0.03 mm, same side); it
    /// takes the candidate's source face. Anything else is left out, not built.
    MatchCandidates,
}

/// A closed contour that wants a contact at about every `spacing_mm`; `arcs` give the arclength of
/// each candidate on it (dental: the outer and the opening rim; spacing is profile data).
#[derive(Clone, Debug, PartialEq)]
pub struct Ring {
    pub perimeter_mm: f64,
    pub spacing_mm: f64,
    pub arcs: Vec<(CandidateId, f64)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PolicyResult {
    /// Painting may only narrow or extend inside what the geometry gates allow.
    pub permitted_faces: FaceMask,
    pub candidates: Vec<Candidate>,
    /// Ordered repair options per contact.
    pub alternates: Vec<(CandidateId, Vec<Candidate>)>,
    pub structures: AllowedStructures,
    /// Maximum repair trials (rebuilds); 0 reports without repairing. Manual contacts are never
    /// moved or deleted.
    pub repair_budget: u32,
    pub landing_rule: LandingRule,
    pub automatic: AutomaticRule,
    /// Contact rings whose coverage the verdict reports (none for a policy without rings).
    pub rings: Vec<Ring>,
}

impl PolicyResult {
    /// A result with no landing rule, every contact as given and no rings.
    pub fn plain(permitted_faces: FaceMask, candidates: Vec<Candidate>, structures: AllowedStructures, repair_budget: u32) -> Self {
        Self { permitted_faces, candidates, alternates: Vec::new(), structures, repair_budget, landing_rule: LandingRule::Unrestricted, automatic: AutomaticRule::AsGiven, rings: Vec::new() }
    }
}

/// Safety verdict per component or contact. A timeout is `Inconclusive`, never `Clear`.
#[derive(Clone, Debug, PartialEq)]
pub enum Verdict {
    Clear,
    Blocked { face: u32, evidence: String },
    Inconclusive { reason: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn face_mask_sets_reads_and_rejects_out_of_range() {
        let mut mask = FaceMask::new(130);
        assert!(mask.set(0, true) && mask.set(64, true) && mask.set(129, true));
        assert!(!mask.set(130, true));
        assert!(mask.get(64) && !mask.get(63) && !mask.get(130));
        assert_eq!(mask.count(), 3);
        mask.set(64, false);
        assert_eq!(mask.count(), 2);
    }

    #[test]
    fn policy_result_holds_the_contract_fields() {
        let candidate = Candidate { id: CandidateId("c1".into()), source_face: Some(7), point: [0.0; 3], normal: [0.0, -1.0, 0.0], origin: Origin::Auto };
        let result = PolicyResult {
            permitted_faces: FaceMask::new(8),
            candidates: vec![candidate.clone()],
            alternates: vec![(candidate.id.clone(), vec![candidate])],
            structures: AllowedStructures { pillar: true, tree: false, brace: false, roof: false, cage: false, raft: true },
            repair_budget: 4,
            landing_rule: LandingRule::Unrestricted,
            automatic: AutomaticRule::AsGiven,
            rings: Vec::new(),
        };
        assert_eq!(result.alternates[0].1.len(), 1);
        assert_eq!(Verdict::Inconclusive { reason: "timeout".into() }, Verdict::Inconclusive { reason: "timeout".into() });
    }
}
