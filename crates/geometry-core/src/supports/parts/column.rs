//! One support column, tip to foot: tip (round / square / cross, tapered / straight, optional
//! contact sphere, penetration), neck, pillar and foot, with a secondary landing tip on the model
//! when the caller supplies one. Port of `contactColumn` and the column loop of TS `buildSupportMesh`.

use super::builder::{MIN_LENGTH, MeshBuilder};
use super::curve::{CurveNode, fillet_polyline};
use super::landing::{Landing, neck_direction, sink_into, up_direction};
use super::profile::tip_profile;
use super::tags::{ContactIntent, IntentKind, Part, Tag};
use crate::core::vec::{V3, add, normalize_or_down, scale, sub};
use crate::supports::policy::{Candidate, Origin};
use crate::supports::settings::{ContactShape, ShapeSettings, SupportSettings, TipProfile, TipSection};

/// A contact as the column builder consumes it: the policy candidate (position and normal in
/// plate space, normal already sampled by the caller), its own shape, and where a column from
/// its neck lands on the model when the caller supplies landings (`LandingSource::Supplied`).
#[derive(Clone, Debug, PartialEq)]
pub struct ColumnContact {
    pub candidate: Candidate,
    pub shape: Option<ShapeSettings>,
    pub landing: Option<Landing>,
    /// SLASG point class of the contact; decides where the neck normal is sampled on the remesh.
    pub kind: ContactKind,
}

/// SLASG point class of a placement contact (manual points are untagged).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ContactKind {
    #[default]
    Unspecified,
    Face,
    Edge,
    Vertical,
}

/// A column that reaches the plate: its pillar end, where the foot is added once every column is built.
pub struct PlateAnchor {
    pub contact: u32,
    pub origin: Origin,
    pub position: V3,
    pub shape: ShapeSettings,
}

struct ContactColumn {
    tip: V3,
    /// Filleted tube curve from the tip down to the transition bottom or the landing point.
    curve: Vec<CurveNode>,
    landing: Option<Landing>,
}

/// True when the tip is not the stock round cone.
pub(super) fn shaped_tip(shape: &ShapeSettings) -> bool {
    shape.tip_section != TipSection::Round || shape.tip_profile == TipProfile::Straight
}

/// A tip segment (contact end first or last): Straight holds the end radius, Square / Cross swap the profile.
pub(super) fn add_tip(builder: &mut MeshBuilder, nodes: &[CurveNode], shape: &ShapeSettings, segments: usize) {
    let radius = shape.tip_radius();
    let path: Vec<CurveNode> = if shape.tip_profile == TipProfile::Straight {
        nodes.iter().map(|node| CurveNode { radius, ..*node }).collect()
    } else {
        nodes.to_vec()
    };
    let profile = (shape.tip_section != TipSection::Round).then(|| tip_profile(shape.tip_section, shape.tip_cross_width));
    builder.tube(&path, segments, profile.as_deref());
}

/// Index of the last node at full pillar radius, or -1; the nodes after it taper into a contact on the model.
pub(super) fn last_thick(nodes: &[CurveNode], radius: f64) -> i64 {
    (0..nodes.len()).rev().find(|&i| nodes[i].radius >= radius - 1e-9).map_or(-1, |i| i as i64)
}

/// JavaScript `Array.prototype.slice` index rules (negative counts from the end).
fn js_slice(nodes: &[CurveNode], start: i64, end: Option<i64>) -> Vec<CurveNode> {
    let len = nodes.len() as i64;
    let fix = |i: i64| if i < 0 { (len + i).max(0) } else { i.min(len) };
    let (a, b) = (fix(start), fix(end.unwrap_or(len)));
    if a >= b { Vec::new() } else { nodes[a as usize..b as usize].to_vec() }
}

/// Lower end of the neck (contact + neck direction x Connection Length): where the landing ray starts.
pub fn neck_bend(contact: &ColumnContact, own: &SupportSettings) -> V3 {
    let normal = normalize_or_down(contact.candidate.normal);
    add(contact.candidate.point, scale(neck_direction(normal, own.shape.max_neck_angle), own.shape.neck_length))
}

/// SLASG_Line for one contact: neck from the sunk tip to b = contact + d x Connection Length,
/// a vertical transition, and the landing decision from the supplied hit below b.
fn contact_column(contact: &ColumnContact, own: &SupportSettings, raft_top: f64, hit: Option<Landing>) -> Option<ContactColumn> {
    let shape = &own.shape;
    let pillar_radius = own.pillar_diameter / 2.0;
    let neck_radius = shape.tip_radius();
    let normal = normalize_or_down(contact.candidate.normal);
    let tip = sub(contact.candidate.point, scale(normal, shape.tip_depth()));
    if tip[1] <= raft_top {
        return None;
    }
    let bend = add(contact.candidate.point, scale(neck_direction(normal, shape.max_neck_angle), shape.neck_length));
    let mut chain = vec![CurveNode { point: tip, radius: neck_radius }, CurveNode { point: bend, radius: pillar_radius }];
    if let Some(hit) = hit {
        if bend[1] - hit.point[1] > 2.0 * shape.neck_length {
            // Inverted neck up to a touch sphere on the model below.
            let up = up_direction(hit.normal, shape.max_neck_angle);
            chain.push(CurveNode {
                point: add(hit.point, scale(up, shape.neck_length - shape.tip_depth())),
                radius: pillar_radius,
            });
        }
        // A bare tip landing on the model reaches Penetration past the surface to fuse with it.
        let landing = if shape.contact_shape == ContactShape::Sphere {
            hit.point
        } else {
            sink_into(chain[chain.len() - 1].point, hit.point, shape.point_depth)
        };
        chain.push(CurveNode { point: landing, radius: neck_radius });
    } else {
        // No clamping: a short column folds back up to Bottom Thickness.
        chain.push(CurveNode { point: [bend[0], bend[1] - own.pillar_diameter, bend[2]], radius: pillar_radius });
    }
    Some(ContactColumn { tip, curve: fillet_polyline(&chain, own.pillar_diameter / 2.0, 3), landing: hit })
}

/// Emits tip, neck(s) and pillar of one contact. Returns the plate anchor when the column
/// reaches the plate (its foot is emitted by `emit_feet`). `None` when nothing is anchored:
/// a column landing on the model, a tips-only preview, or a contact whose tip is under the raft.
pub fn emit_column(
    builder: &mut MeshBuilder,
    index: u32,
    contact: &ColumnContact,
    settings: &SupportSettings,
    raft_top: f64,
    segments: usize,
    tip_only: bool,
    landing: Option<Landing>,
) -> Option<PlateAnchor> {
    let own = settings.with_shape(contact.shape.as_ref());
    let shape = own.shape;
    let origin = contact.candidate.origin;
    let pillar_radius = own.pillar_diameter / 2.0;
    // A tips-only preview casts no landing for its geometry.
    let hit = if tip_only { None } else { landing };
    let column = contact_column(contact, &own, raft_top, hit)?;
    let neck_end = column.curve.iter().enumerate().position(|(i, node)| i > 0 && node.radius == pillar_radius).map_or(-1, |i| i as i64);
    let neck = js_slice(&column.curve, 0, Some(neck_end + 1));
    let mut pillar = js_slice(&column.curve, neck_end, None);
    let shaped = shaped_tip(&shape);
    let mut secondary_neck: Option<Vec<CurveNode>> = None;
    if column.landing.is_some() && shaped {
        let last = last_thick(&pillar, pillar_radius);
        if last < pillar.len() as i64 - 1 {
            secondary_neck = Some(js_slice(&pillar, last, None));
        }
        pillar = js_slice(&pillar, 0, Some(last + 1));
    }
    if shape.contact_shape == ContactShape::Sphere {
        builder.begin(Tag::owned(Part::Tip, index, origin));
        builder.sphere(column.tip, shape.touch_diameter / 2.0, segments);
        builder.end();
        if let Some(landing) = &column.landing {
            builder.begin(Tag::owned(Part::Tip, index, origin));
            builder.sphere(landing.point, shape.touch_diameter / 2.0, segments);
            builder.end();
        }
    }
    let mut neck_tag = Tag::owned(Part::Neck, index, origin);
    if let Some(face) = contact.candidate.source_face {
        neck_tag.intents.push(ContactIntent {
            kind: IntentKind::Primary,
            contact: Some(index),
            point: contact.candidate.point,
            normal: contact.candidate.normal,
            face: Some(face),
        });
    }
    builder.begin(neck_tag);
    add_tip(builder, &neck, &shape, segments);
    builder.end();
    if tip_only {
        return None;
    }
    if let Some(secondary) = &secondary_neck {
        // The tip landing on the model below gets the same shape as the top one.
        builder.begin(Tag::owned(Part::Neck, index, origin));
        add_tip(builder, secondary, &shape, segments);
        builder.end();
    }
    let reach = (column.landing.is_some() && !shaped).then_some(shape.neck_length);
    builder.begin(Tag::owned(Part::Pillar, index, origin).reach(reach));
    builder.tube(&pillar, segments, None);
    builder.end();
    column.landing.is_none().then(|| PlateAnchor {
        contact: index,
        origin,
        position: column.curve[column.curve.len() - 1].point,
        shape,
    })
}

/// Pillar run down to the foot top and the foot frustum of every plate-landing column.
pub fn emit_feet(builder: &mut MeshBuilder, anchors: &[PlateAnchor], pillar_radius: f64, segments: usize) {
    for anchor in anchors {
        let [x, y, z] = anchor.position;
        let foot_top = anchor.shape.base_height;
        builder.begin(Tag::owned(Part::Pillar, anchor.contact, anchor.origin));
        if (y - foot_top).abs() > MIN_LENGTH {
            builder.frustum(anchor.position, [x, foot_top, z], pillar_radius, pillar_radius, segments);
        }
        builder.end();
        builder.begin(Tag::owned(Part::Foot, anchor.contact, anchor.origin));
        builder.frustum([x, 0.0, z], [x, foot_top, z], anchor.shape.base_diameter / 2.0, pillar_radius, segments);
        builder.end();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::policy::CandidateId;
    use crate::supports::settings::default_values;

    fn contact(point: V3) -> ColumnContact {
        ColumnContact {
            candidate: Candidate { id: CandidateId("c".into()), source_face: Some(3), point, normal: [0.0, -1.0, 0.0], origin: Origin::Auto },
            shape: None,
            landing: None,
            kind: ContactKind::default(),
        }
    }

    #[test]
    fn plate_column_emits_neck_pillar_foot_with_tags() {
        let mut values = default_values();
        values[22] = 0.0; // raftEnabled off
        let settings = SupportSettings::from_slice(&values).unwrap();
        let mut builder = MeshBuilder::new();
        let anchor = emit_column(&mut builder, 0, &contact([0.0, 10.0, 0.0]), &settings, 0.0, 12, false, None).unwrap();
        emit_feet(&mut builder, &[anchor], settings.pillar_diameter / 2.0, 12);
        let mesh = builder.finish();
        let parts: Vec<Part> = mesh.components.iter().map(|c| c.tag.part).collect();
        assert_eq!(parts, [Part::Neck, Part::Pillar, Part::Pillar, Part::Foot]);
        assert_eq!(mesh.components[0].tag.intents.len(), 1);
        assert!(mesh.components.iter().all(|c| c.tag.contact == Some(0) && c.tag.origin == Some(Origin::Auto)));
    }

    #[test]
    fn tip_under_the_raft_top_builds_nothing() {
        let settings = SupportSettings::from_slice(&default_values()).unwrap();
        let mut builder = MeshBuilder::new();
        assert!(emit_column(&mut builder, 0, &contact([0.0, 0.5, 0.0]), &settings, 1.0, 12, false, None).is_none());
        assert!(builder.finish().components.is_empty());
    }

    #[test]
    fn js_slice_follows_negative_index_rules() {
        let n = |y: f64| CurveNode { point: [0.0, y, 0.0], radius: 1.0 };
        let v = [n(0.0), n(1.0), n(2.0)];
        assert_eq!(js_slice(&v, -1, None).len(), 1);
        assert_eq!(js_slice(&v, 0, Some(0)).len(), 0);
        assert_eq!(js_slice(&v, 1, None).len(), 2);
    }
}
