//! Neck re-aim, the first repair of a crossing tip: an automatic contact whose tip or neck runs back
//! into the model is rebuilt with its neck along the source face's own normal (still clamped to the
//! maximum neck angle by the column builder), and if it still crosses, straight down. A contact
//! that crosses after both is left out by the repair like a crossing pillar. Policy-free: only the
//! direction of the neck changes, never the contact point, its id or its source face.

use crate::core::vec::{V3, cross, dot, length, sub};
use crate::supports::parts::column::{ColumnContact, ContactKind};
use crate::supports::parts::model::Model;
use crate::supports::policy::Origin;

/// The direction a re-aimed neck is built along, in the order the repair tries them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Aim {
    /// The source face's own normal (the exact model triangle), not a sampled or smoothed one.
    Face,
    /// Straight down to the plate.
    Down,
}

pub const AIMS: [Aim; 2] = [Aim::Face, Aim::Down];

/// Unit normal of a model triangle, or `None` for a degenerate one.
fn face_normal(model: &Model, face: u32) -> Option<V3> {
    if face as usize >= model.face_count() {
        return None;
    }
    let [a, b, c] = model.triangle(face);
    let n = cross(sub(b, a), sub(c, a));
    let size = length(n);
    (size > 0.0 && size.is_finite()).then(|| [n[0] / size, n[1] / size, n[2] / size])
}

/// The neck normal `aim` gives this contact, or `None` when it has none (no source face).
pub fn aimed_normal(model: Option<&Model>, contact: &ColumnContact, aim: Aim) -> Option<V3> {
    match aim {
        Aim::Down => Some([0.0, -1.0, 0.0]),
        Aim::Face => {
            let normal = face_normal(model?, contact.candidate.source_face?)?;
            // Winding may be locally reversed: keep the side the contact was placed on.
            Some(if dot(normal, contact.candidate.normal) < 0.0 { [-normal[0], -normal[1], -normal[2]] } else { normal })
        }
    }
}

/// Re-aims the neck of an automatic contact; false (and unchanged) when the aim gives no direction
/// or would build the same neck again. A manual contact is never changed. The normal is taken as
/// given by the builder (`ContactKind::Unspecified`), so no sampled normal replaces it.
pub fn reaim(model: Option<&Model>, contact: &mut ColumnContact, aim: Aim) -> bool {
    if contact.candidate.origin == Origin::Manual {
        return false;
    }
    let Some(normal) = aimed_normal(model, contact, aim) else { return false };
    if contact.kind == ContactKind::Unspecified && contact.candidate.normal == normal {
        return false;
    }
    contact.candidate.normal = normal;
    contact.kind = ContactKind::Unspecified;
    contact.landing = None;
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::spatial::Bvh;
    use crate::supports::policy::{Candidate, CandidateId};

    fn contact(normal: V3, face: Option<u32>, origin: Origin) -> ColumnContact {
        ColumnContact {
            candidate: Candidate { id: CandidateId("c".into()), source_face: face, point: [0.0, 0.0, 0.0], normal, origin },
            shape: None,
            landing: None,
            kind: ContactKind::Face,
        }
    }

    #[test]
    fn face_aim_takes_the_exact_triangle_normal_on_the_contact_side_and_down_is_down() {
        // One triangle in the XZ plane wound to face +Y; the contact says it faces down (-Y).
        let positions = [0.0f32, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0];
        let indices = [0u32, 1, 2];
        let bvh = Bvh::build(&positions, &indices);
        let model = Model::new(&positions, &indices, &bvh);
        let mut c = contact([0.3, -0.9, 0.0], Some(0), Origin::Auto);
        assert!(reaim(Some(&model), &mut c, Aim::Face));
        assert_eq!(c.candidate.normal, [0.0, -1.0, 0.0]);
        assert_eq!(c.kind, ContactKind::Unspecified);
        // The same neck again is not a rebuild.
        assert!(!reaim(Some(&model), &mut c, Aim::Face));
        assert!(!reaim(Some(&model), &mut c, Aim::Down));
        let mut side = contact([1.0, 0.0, 0.0], None, Origin::Auto);
        assert!(!reaim(Some(&model), &mut side, Aim::Face), "no source face, no face aim");
        assert!(reaim(Some(&model), &mut side, Aim::Down));
        assert_eq!(side.candidate.normal, [0.0, -1.0, 0.0]);
    }

    #[test]
    fn a_manual_contact_is_never_reaimed() {
        let mut c = contact([1.0, 0.0, 0.0], None, Origin::Manual);
        assert!(!reaim(None, &mut c, Aim::Down));
        assert_eq!(c.candidate.normal, [1.0, 0.0, 0.0]);
    }
}
