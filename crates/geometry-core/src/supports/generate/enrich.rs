//! Face identity for the safety review. A contact that carries no source face (every generic
//! contact: placement does not record one) cannot prove that its tip may touch the surface it was
//! placed on, so the review would call every such tip inconclusive. The face is found here from the
//! contact point (nearest source face within 0.1 mm that faces the same way) and handed to the review
//! as contact intents on a copy of the component tags; the built mesh and its tags are not changed.
//! No face found means no exemption: that tip stays inconclusive.

use crate::supports::build::{BuiltSupports, Ground};
use crate::supports::parts::column::ColumnContact;
use crate::supports::parts::model::closest_on_triangle;
use crate::supports::parts::tags::{Component, ContactIntent, IntentKind, Part};
use crate::supports::parts::vec::{V3, cross, dot, length, sub};
use crate::supports::safety::index::CollisionIndex;

const FACE_TOLERANCE_MM: f64 = 0.1;

/// The source face a contact point lies on, for a normal pointing out of the model.
pub fn derive_face(index: &CollisionIndex, point: V3, normal: V3) -> Option<u32> {
    if !index.valid {
        return None;
    }
    let cell = index.cell_mm;
    let (cx, cz) = ((point[0] / cell).floor() as i64, (point[2] / cell).floor() as i64);
    let mut best: Option<(f64, u32)> = None;
    for x in cx - 1..=cx + 1 {
        for z in cz - 1..=cz + 1 {
            for &face in index.cell(x, z) {
                let [a, b, c] = index.triangle(face as usize);
                let n = cross(sub(b, a), sub(c, a));
                let size = length(n);
                if size == 0.0 || dot(n, normal) / size <= 0.3 * length(normal) {
                    continue;
                }
                let d = length(sub(closest_on_triangle(point, a, b, c), point));
                if d <= FACE_TOLERANCE_MM && best.is_none_or(|(bd, bf)| d < bd || (d == bd && face < bf)) {
                    best = Some((d, face));
                }
            }
        }
    }
    best.map(|(_, face)| face)
}

/// The built components with contact intents completed from derived faces and recorded landings.
pub fn review_components(index: &CollisionIndex, contacts: &[ColumnContact], built: &BuiltSupports) -> Vec<Component> {
    let faces: Vec<Option<u32>> = contacts
        .iter()
        .map(|c| c.candidate.source_face.or_else(|| derive_face(index, c.candidate.point, c.candidate.normal)))
        .collect();
    let mut seen_neck = vec![false; contacts.len()];
    built
        .components
        .iter()
        .map(|component| {
            let mut out = component.clone();
            let Some(k) = out.tag.contact.map(|k| k as usize) else { return out };
            for intent in &mut out.tag.intents {
                if intent.kind == IntentKind::Primary && intent.face.is_none() {
                    intent.face = intent.contact.and_then(|c| faces.get(c as usize).copied().flatten());
                }
            }
            if !out.tag.intents.is_empty() {
                return out;
            }
            let primary = ContactIntent { kind: IntentKind::Primary, contact: Some(k as u32), point: contacts[k].candidate.point, normal: contacts[k].candidate.normal, face: faces[k] };
            let secondary = match built.grounds.get(k) {
                Some(Ground::Model { face, point, normal }) => Some(ContactIntent { kind: IntentKind::Secondary, contact: None, point: *point, normal: *normal, face: *face }),
                _ => None,
            };
            match out.tag.part {
                // The first neck of a column is its primary tip; a later one is the landing tip.
                Part::Neck if out.tag.structure_kind.is_none() => {
                    if std::mem::replace(&mut seen_neck[k], true) {
                        out.tag.intents.extend(secondary);
                    } else {
                        out.tag.intents.push(primary);
                    }
                }
                Part::Pillar if out.tag.landing_reach.is_some() => out.tag.intents.extend(secondary),
                _ => {}
            }
            out
        })
        .collect()
}
