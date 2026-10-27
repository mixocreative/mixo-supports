//! Typed-array encoding of the support build (the ABI both Rust tests and WASM use).
//!
//! In, per contact, `CONTACT_STRIDE` f64: point xyz, normal xyz, source face (-1 none), origin
//! (0 auto, 1 manual), has landing (0/1), landing point xyz, landing normal xyz, landing face (-1 none).
//! The landing fields are read only with supplied landings (see `build::LandingSource`); otherwise
//! the build casts them against the model. Tree landings (supplied mode) are `TREE_LANDING_STRIDE`
//! f64 each: has landing, point xyz, normal xyz, face (-1 none), has source point, source xyz.
//! Optional `shapes`: `SHAPE_LAYOUT.len()` f64 per contact (NaN = follows the object).
//!
//! Out, per component, `COMPONENT_STRIDE` u32: part, structure kind (0 none), contact index
//! (`NO_CONTACT` none), origin (0 none, 1 auto, 2 manual), first index, index count, first intent,
//! intent count; one f64 landing reach (NaN none); per intent `INTENT_STRIDE` f64: kind (1 primary,
//! 2 secondary), contact (-1 none), face (-1 none), point xyz, normal xyz.

use super::build::BuiltSupports;
use super::error::BuildError;
use super::parts::autotree::{AutoTree, AutoTreeLayout};
use super::parts::column::ColumnContact;
use super::parts::landing::Landing;
use super::parts::tags::Component;
use super::policy::{Candidate, CandidateId, Origin};
use super::settings::{SHAPE_LAYOUT, ShapeSettings};

pub const CONTACT_STRIDE: usize = 16;
pub const TREE_LANDING_STRIDE: usize = 12;
pub const COMPONENT_STRIDE: usize = 8;
pub const INTENT_STRIDE: usize = 9;
pub const NO_CONTACT: u32 = u32::MAX;

pub fn decode_contacts(ids: &[String], values: &[f64], shapes: &[f64], base: &ShapeSettings) -> Result<Vec<ColumnContact>, BuildError> {
    if values.len() != ids.len() * CONTACT_STRIDE {
        return Err(BuildError::BadInput("contacts length"));
    }
    if !shapes.is_empty() && shapes.len() != ids.len() * SHAPE_LAYOUT.len() {
        return Err(BuildError::BadInput("shapes length"));
    }
    let face = |v: f64| (v >= 0.0).then_some(v as u32);
    ids.iter()
        .enumerate()
        .map(|(k, id)| {
            let v = &values[k * CONTACT_STRIDE..(k + 1) * CONTACT_STRIDE];
            if v[..9].iter().any(|x| !x.is_finite()) || (v[8] != 0.0 && v[9..].iter().any(|x| !x.is_finite())) {
                return Err(BuildError::BadInput("contact value not finite"));
            }
            let shape = if shapes.is_empty() {
                None
            } else {
                let own = &shapes[k * SHAPE_LAYOUT.len()..(k + 1) * SHAPE_LAYOUT.len()];
                (!own.iter().all(|x| x.is_nan())).then(|| ShapeSettings::overridden(base, own)).transpose()?
            };
            Ok(ColumnContact {
                candidate: Candidate {
                    id: CandidateId(id.clone()),
                    source_face: face(v[6]),
                    point: [v[0], v[1], v[2]],
                    normal: [v[3], v[4], v[5]],
                    origin: if v[7] == 1.0 { Origin::Manual } else { Origin::Auto },
                },
                shape,
                landing: (v[8] != 0.0).then(|| Landing { point: [v[9], v[10], v[11]], normal: [v[12], v[13], v[14]], face: face(v[15]), source_point: None }),
            })
        })
        .collect()
}

pub fn decode_tree_landings(values: &[f64]) -> Result<Vec<Option<Landing>>, BuildError> {
    if values.len() % TREE_LANDING_STRIDE != 0 {
        return Err(BuildError::BadInput("tree landings length"));
    }
    values
        .chunks(TREE_LANDING_STRIDE)
        .map(|v| {
            if v[0] == 0.0 {
                return Ok(None);
            }
            if v[1..11].iter().any(|x| !x.is_finite()) {
                return Err(BuildError::BadInput("tree landing value not finite"));
            }
            Ok(Some(Landing {
                point: [v[1], v[2], v[3]],
                normal: [v[4], v[5], v[6]],
                face: (v[7] >= 0.0).then_some(v[7] as u32),
                source_point: (v[8] != 0.0).then_some([v[9], v[10], v[11]]),
            }))
        })
        .collect()
}

/// Flat per-component tables of a build.
pub struct ComponentTable {
    pub tags: Vec<u32>,
    pub reach: Vec<f64>,
    pub intents: Vec<f64>,
}

pub fn encode_components(built: &BuiltSupports) -> ComponentTable {
    encode(&built.components)
}

fn encode(components: &[Component]) -> ComponentTable {
    let mut table = ComponentTable { tags: Vec::new(), reach: Vec::new(), intents: Vec::new() };
    let mut intent_count = 0u32;
    for component in components {
        let tag = &component.tag;
        table.tags.extend([
            tag.part as u32,
            tag.structure_kind.map_or(0, |k| k as u32),
            tag.contact.unwrap_or(NO_CONTACT),
            match tag.origin {
                None => 0,
                Some(Origin::Auto) => 1,
                Some(Origin::Manual) => 2,
            },
            component.start,
            component.count,
            intent_count,
            tag.intents.len() as u32,
        ]);
        table.reach.push(tag.landing_reach.unwrap_or(f64::NAN));
        for intent in &tag.intents {
            table.intents.extend([
                f64::from(intent.kind as u8),
                intent.contact.map_or(-1.0, f64::from),
                intent.face.map_or(-1.0, f64::from),
                intent.point[0], intent.point[1], intent.point[2],
                intent.normal[0], intent.normal[1], intent.normal[2],
            ]);
        }
        intent_count += tag.intents.len() as u32;
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::settings::{SupportSettings, default_values};

    #[test]
    fn decodes_contacts_and_encodes_components() {
        let base = SupportSettings::from_slice(&default_values()).unwrap().shape;
        let mut v = vec![0.0; CONTACT_STRIDE];
        v[1] = 8.0;
        v[4] = -1.0;
        v[6] = 5.0;
        v[7] = 1.0;
        let contacts = decode_contacts(&["a".into()], &v, &[], &base).unwrap();
        assert_eq!(contacts[0].candidate.source_face, Some(5));
        assert_eq!(contacts[0].candidate.origin, Origin::Manual);
        assert!(contacts[0].landing.is_none() && contacts[0].shape.is_none());
        assert_eq!(decode_contacts(&["a".into()], &v[..3], &[], &base).err(), Some(BuildError::BadInput("contacts length")));
    }

    #[test]
    fn decodes_a_host_layout_and_rejects_a_malformed_one() {
        assert_eq!(decode_layout(&[], 3).unwrap(), None);
        // One tree of members 0 and 2 at (1, 2, 3); contact 1 removed.
        let layout = decode_layout(&[1.0, 1.0, 2.0, 3.0, 2.0, 0.0, 2.0, 1.0, 1.0], 3).unwrap().unwrap();
        assert_eq!(layout.trees[0].members, vec![0, 2]);
        assert_eq!(layout.trees[0].junction, [1.0, 2.0, 3.0]);
        assert_eq!(layout.removed, vec![false, true, false]);
        assert!(decode_layout(&[1.0, 1.0, 2.0, 3.0, 2.0, 0.0], 3).is_err(), "truncated");
        assert!(decode_layout(&[0.0, 1.0, 7.0], 3).is_err(), "removed index out of range");
        assert!(decode_layout(&[0.0, 0.0, 9.0], 3).is_err(), "trailing values");
    }
}

/// A host-computed Auto Tree layout: empty = none supplied; else `[n_trees, (junction xyz, n_members,
/// members...) per tree, n_removed, removed contact indices...]`.
pub fn decode_layout(values: &[f64], contacts: usize) -> Result<Option<AutoTreeLayout>, BuildError> {
    if values.is_empty() {
        return Ok(None);
    }
    let bad = BuildError::BadInput("layout");
    let mut at = 0;
    let mut next = || -> Result<f64, BuildError> {
        let v = *values.get(at).ok_or(BuildError::BadInput("layout"))?;
        at += 1;
        if v.is_finite() { Ok(v) } else { Err(BuildError::BadInput("layout")) }
    };
    let count = |v: f64| if v >= 0.0 && v.fract() == 0.0 { Ok(v as usize) } else { Err(BuildError::BadInput("layout")) };
    let mut trees = Vec::new();
    for _ in 0..count(next()?)? {
        let junction = [next()?, next()?, next()?];
        let mut members = Vec::new();
        for _ in 0..count(next()?)? {
            members.push(count(next()?)?);
        }
        trees.push(AutoTree { junction, members });
    }
    let mut removed = vec![false; contacts];
    for _ in 0..count(next()?)? {
        *removed.get_mut(count(next()?)?).ok_or(BuildError::BadInput("layout"))? = true;
    }
    if at != values.len() {
        return Err(bad);
    }
    Ok(Some(AutoTreeLayout { trees, removed }))
}
