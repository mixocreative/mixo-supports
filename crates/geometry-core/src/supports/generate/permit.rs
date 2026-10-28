//! What a `PolicyResult` permits, as data: which automatic contacts may be built (they must reproduce
//! a candidate; ports of TS `dentalPrimaryFace.ts`) and where a secondary contact may land (port of
//! TS `dentalLandingSide.ts`). Neither is dental-specific: dental only supplies the data.

use crate::supports::parts::column::ColumnContact;
use crate::supports::parts::landing::Landing;
use crate::supports::parts::model::Model;
use crate::core::vec::{V3, cross, dot, sub};
use crate::supports::policy::{AutomaticRule, Candidate, LandingRule, Origin, PolicyResult};
use crate::supports::settings::SupportSettings;

/// Whether a contact at `point` with `normal` reproduces `candidate`: within `tol_mm` and with
/// normals whose dot product exceeds `min_dot` (the policy's `AutomaticRule::MatchCandidates`).
pub fn same_primary(point: V3, normal: V3, candidate: &Candidate, tol_mm: f64, min_dot: f64) -> bool {
    let d = sub(candidate.point, point);
    dot(d, d) < tol_mm * tol_mm && dot(candidate.normal, normal) > min_dot
}

/// Exact source-face identity of an accepted primary contact, or `None` on ambiguity (two matching
/// candidates on different faces) or when a match carries no face.
pub fn primary_source_face(point: V3, normal: V3, candidates: &[Candidate], tol_mm: f64, min_dot: f64) -> Option<u32> {
    let mut face: Option<u32> = None;
    for candidate in candidates {
        if !same_primary(point, normal, candidate, tol_mm, min_dot) {
            continue;
        }
        let candidate_face = candidate.source_face?;
        if face.is_some_and(|f| f != candidate_face) {
            return None;
        }
        face = Some(candidate_face);
    }
    face
}

/// The contacts the engine may build and what was left out.
pub struct Permitted {
    pub contacts: Vec<ColumnContact>,
    /// For each kept contact, the candidate it reproduces (`None`: a manual contact, or a policy
    /// that takes contacts as given).
    pub candidate_of: Vec<Option<usize>>,
    /// Automatic contacts the policy does not permit, in input order.
    pub rejected: Vec<String>,
}

pub fn permit(contacts: Vec<ColumnContact>, policy: &PolicyResult) -> Permitted {
    let mut out = Permitted { contacts: Vec::new(), candidate_of: Vec::new(), rejected: Vec::new() };
    for mut contact in contacts {
        let AutomaticRule::MatchCandidates { tol_mm, min_dot } = policy.automatic else {
            out.contacts.push(contact);
            out.candidate_of.push(None);
            continue;
        };
        if contact.candidate.origin == Origin::Manual {
            out.contacts.push(contact);
            out.candidate_of.push(None);
            continue;
        }
        let (point, normal) = (contact.candidate.point, contact.candidate.normal);
        let matched = policy.candidates.iter().position(|c| same_primary(point, normal, c, tol_mm, min_dot));
        match matched {
            Some(k) => {
                contact.candidate.source_face = primary_source_face(point, normal, &policy.candidates, tol_mm, min_dot);
                out.contacts.push(contact);
                out.candidate_of.push(Some(k));
            }
            None => out.rejected.push(contact.candidate.id.0.clone()),
        }
    }
    out
}

/// The settings with the policy's own Tree/Brace choice applied (`limit_structures` bounds them after).
pub fn chosen_settings(settings: &SupportSettings, policy: &PolicyResult) -> SupportSettings {
    let mut s = settings.clone();
    if let Some(choice) = policy.structure_choice {
        s.scatter_auto_tree = choice.tree;
        s.truss_enabled = choice.brace;
    }
    s
}

/// The landing rule of the policy as a predicate over a landing on the model (plate space).
pub fn landing_allowed<'a>(model: &'a Model<'a>, policy: &'a PolicyResult) -> Option<impl Fn(&Landing) -> bool + 'a> {
    let LandingRule::ApprovedFaces { stamps } = &policy.landing_rule else { return None };
    Some(move |landing: &Landing| {
        let Some(face) = landing.face.filter(|&f| (f as usize) < model.face_count()) else { return false };
        let [a, b, c] = model.triangle(face);
        let n = cross(sub(b, a), sub(c, a));
        let size = dot(n, n).sqrt();
        let normal = if size == 0.0 { [0.0; 3] } else { [n[0] / size, n[1] / size, n[2] / size] };
        // The landing ray travels down in print space: the exact source triangle must face up.
        if normal[1] <= 1e-6 {
            return false;
        }
        if !policy.permitted_faces.get(face as usize) {
            return false;
        }
        let point = landing.source_point.unwrap_or(landing.point);
        for stamp in stamps.iter().rev() {
            let d = sub(point, stamp.center);
            if dot(d, d) > stamp.radius * stamp.radius || dot(normal, stamp.normal) <= 0.0 {
                continue;
            }
            return stamp.allow;
        }
        true
    })
}
