//! What a `PolicyResult` permits, as data: which automatic contacts may be built (they must reproduce
//! a candidate; ports of TS `dentalPrimaryFace.ts`) and where a secondary contact may land (port of
//! TS `dentalLandingSide.ts`). Neither is dental-specific: dental only supplies the data.

use crate::supports::parts::column::ColumnContact;
use crate::supports::parts::landing::Landing;
use crate::supports::parts::model::Model;
use crate::supports::parts::vec::{V3, cross, dot, sub};
use crate::supports::policy::{AutomaticRule, Candidate, LandingRule, Origin, PolicyResult};

/// A contact reproduces a candidate within this distance (mm) and on the same side.
pub const POSITION_TOLERANCE_MM: f64 = 0.03;
pub const NORMAL_DOT_MINIMUM: f64 = 0.95;

/// Preserve the placement/final-build match threshold for a face-anchored tip.
pub fn same_primary(point: V3, normal: V3, candidate: &Candidate) -> bool {
    let d = sub(candidate.point, point);
    dot(d, d) < POSITION_TOLERANCE_MM * POSITION_TOLERANCE_MM && dot(candidate.normal, normal) > NORMAL_DOT_MINIMUM
}

/// Exact source-face identity of an accepted primary contact, or `None` on ambiguity (two matching
/// candidates on different faces) or when a match carries no face.
pub fn primary_source_face(point: V3, normal: V3, candidates: &[Candidate]) -> Option<u32> {
    let mut face: Option<u32> = None;
    for candidate in candidates {
        if !same_primary(point, normal, candidate) {
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
        if contact.candidate.origin == Origin::Manual || policy.automatic == AutomaticRule::AsGiven {
            out.contacts.push(contact);
            out.candidate_of.push(None);
            continue;
        }
        let (point, normal) = (contact.candidate.point, contact.candidate.normal);
        let matched = policy.candidates.iter().position(|c| same_primary(point, normal, c));
        match matched {
            Some(k) => {
                contact.candidate.source_face = primary_source_face(point, normal, &policy.candidates);
                out.contacts.push(contact);
                out.candidate_of.push(Some(k));
            }
            None => out.rejected.push(contact.candidate.id.0.clone()),
        }
    }
    out
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
