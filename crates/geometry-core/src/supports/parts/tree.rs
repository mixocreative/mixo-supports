//! One Auto Tree as SLASG_Line + SLASG_Tree2 + SLASG_Realizer build it (port of TS `treeGeometry` /
//! `addTree`): each leaf keeps its tip and neck (Upper diameter -> Middle diameter), then a branch to
//! the junction. The junction lands on the model when a ray cast down from it hits (an inverted neck
//! beyond 2 x Connection Length), otherwise a trunk of Middle diameter x sqrt(1 + (leaves - 1) x
//! Increment/100) drops to the plate with a foot widened by the same amount. A junction of more
//! than two branches gets a sphere of 0.55 x diameter; a two-branch junction stays one filleted curve.

use super::autotree::AutoTree;
use super::brace::Column;
use super::builder::MeshBuilder;
use super::column::{ColumnContact, add_tip, last_thick, shaped_tip};
use super::curve::{CurveNode, fillet_polyline};
use super::landing::{Landing, neck_direction, sink_into, up_direction};
use super::model::hypot3;
use super::tags::{ContactIntent, IntentKind, Part, StructureKind, Tag};
use super::vec::{V3, add, normalize_or_down, scale, sub};
use crate::supports::settings::{ContactShape, SupportSettings};

struct Curve {
    part: Part,
    owner: Option<usize>,
    nodes: Vec<CurveNode>,
    intents: Vec<ContactIntent>,
}

struct Sphere {
    part: Part,
    owner: Option<usize>,
    centre: V3,
    radius: f64,
}

pub struct TreeGeometry {
    curves: Vec<Curve>,
    spheres: Vec<Sphere>,
    pub trunk: Option<Column>,
}

struct Branch {
    index: usize,
    nodes: Vec<CurveNode>,
}

/// SLASG_Tree2 landing ray start: Middle diameter above the junction.
pub fn landing_source(tree: &AutoTree, s: &SupportSettings) -> V3 {
    [tree.junction[0], tree.junction[1] + s.pillar_diameter, tree.junction[2]]
}

fn primary(index: usize, contact: &ColumnContact) -> ContactIntent {
    ContactIntent {
        kind: IntentKind::Primary,
        contact: Some(index as u32),
        point: contact.candidate.point,
        normal: contact.candidate.normal,
        face: contact.candidate.source_face,
    }
}

/// Branch end through the junction: the leaf's nodes, the landing run, then the junction centre.
fn through(nodes: &[CurveNode], end: &[CurveNode], centre: V3, radius: f64) -> Vec<CurveNode> {
    let mut path = nodes.to_vec();
    path.extend_from_slice(&end[..end.len() - 1]);
    path.push(CurveNode { point: centre, radius });
    path
}

pub fn tree_geometry(tree: &AutoTree, contacts: &[ColumnContact], s: &SupportSettings, hit: Option<Landing>) -> TreeGeometry {
    let mut out = TreeGeometry { curves: Vec::new(), spheres: Vec::new(), trunk: None };
    let pillar_radius = s.pillar_diameter / 2.0;
    let neck_radius = s.tip_radius();
    let spheres = s.shape.contact_shape == ContactShape::Sphere;
    let branches: Vec<Branch> = tree
        .members
        .iter()
        .map(|&member| {
            let contact = &contacts[member];
            let normal = normalize_or_down(contact.candidate.normal);
            let tip = sub(contact.candidate.point, scale(normal, s.tip_depth()));
            let neck_end = add(contact.candidate.point, scale(neck_direction(normal, s.shape.max_neck_angle), s.shape.neck_length));
            if spheres {
                out.spheres.push(Sphere { part: Part::Tip, owner: Some(member), centre: tip, radius: s.shape.touch_diameter / 2.0 });
            }
            Branch {
                index: member,
                nodes: vec![CurveNode { point: tip, radius: neck_radius }, CurveNode { point: neck_end, radius: pillar_radius }],
            }
        })
        .collect();

    let junction = tree.junction;
    let source = landing_source(tree, s);
    let tree_radius = pillar_radius * (1.0 + (tree.members.len() as f64 - 1.0) * (s.tree_section_increment / 100.0)).sqrt();
    let mut end: Vec<CurveNode>;
    let junction_radius: f64;
    let trunk: Option<Vec<CurveNode>>;
    if let Some(hit) = &hit {
        junction_radius = neck_radius;
        end = if source[1] - hit.point[1] > 2.0 * s.shape.neck_length {
            vec![
                CurveNode {
                    point: add(hit.point, scale(up_direction(hit.normal, s.shape.max_neck_angle), s.shape.neck_length - s.tip_depth())),
                    radius: tree_radius,
                },
                CurveNode { point: hit.point, radius: neck_radius },
            ]
        } else {
            vec![CurveNode { point: hit.point, radius: neck_radius }]
        };
        // A bare tip landing on the model reaches Penetration past the surface to fuse with it.
        if !spheres {
            let from = if end.len() > 1 { end[0].point } else { add(hit.point, [0.0, 1.0, 0.0]) };
            let last = end.len() - 1;
            end[last] = CurveNode { point: sink_into(from, hit.point, s.shape.point_depth), radius: neck_radius };
        } else {
            out.spheres.push(Sphere { part: Part::Tip, owner: None, centre: hit.point, radius: s.shape.touch_diameter / 2.0 });
        }
        trunk = None;
    } else {
        junction_radius = tree_radius;
        end = vec![CurveNode { point: junction, radius: tree_radius }];
        let (x, z) = (junction[0], junction[2]);
        trunk = Some(vec![
            CurveNode { point: junction, radius: tree_radius },
            CurveNode { point: [x, s.shape.base_height, z], radius: tree_radius },
            CurveNode { point: [x, 0.0, z], radius: s.shape.base_diameter / 2.0 + (tree_radius - pillar_radius) },
        ]);
        out.trunk = Some(Column { x, z, bottom: s.shape.base_height, top: junction[1] });
    }
    let centre = end[end.len() - 1].point;
    let secondary: Vec<ContactIntent> = hit
        .iter()
        .map(|h| ContactIntent { kind: IntentKind::Secondary, contact: None, point: h.source_point.unwrap_or(h.point), normal: h.normal, face: h.face })
        .collect();
    let degree = branches.len() + usize::from(trunk.is_some());
    let fillet = s.pillar_diameter / 2.0;
    if degree == 2 && trunk.is_none() {
        let (a, b) = (&branches[0], &branches[1]);
        let mut path = through(&a.nodes, &end, centre, junction_radius);
        path.extend(b.nodes.iter().rev().copied());
        let mut intents = vec![primary(a.index, &contacts[a.index]), primary(b.index, &contacts[b.index])];
        intents.extend(secondary);
        out.curves.push(Curve { part: Part::TreeBranch, owner: Some(a.index), nodes: fillet_polyline(&path, fillet, 3), intents });
        return out;
    }
    for branch in &branches {
        let path = through(&branch.nodes, &end, centre, junction_radius);
        let mut intents = vec![primary(branch.index, &contacts[branch.index])];
        intents.extend(secondary.iter().copied());
        out.curves.push(Curve { part: Part::TreeBranch, owner: Some(branch.index), nodes: fillet_polyline(&path, fillet, 3), intents });
    }
    if let Some(trunk) = trunk {
        out.curves.push(Curve { part: Part::TreeTrunk, owner: None, nodes: fillet_polyline(&trunk, fillet, 3), intents: Vec::new() });
    }
    if degree > 2 {
        out.spheres.push(Sphere { part: Part::TreeTrunk, owner: None, centre, radius: 0.55 * 2.0 * junction_radius });
    }
    out
}

fn tag_for(part: Part, owner: Option<usize>, contacts: &[ColumnContact]) -> Tag {
    match owner {
        Some(index) => Tag::owned(part, index as u32, contacts[index].candidate.origin),
        None => Tag::new(part),
    }
}

/// The intent whose point is closest to `point` (the first on a tie), as a list of at most one.
fn intent_at(intents: &[ContactIntent], point: V3) -> Vec<ContactIntent> {
    let mut best: Option<&ContactIntent> = None;
    for intent in intents {
        if best.is_none_or(|b| hypot3(sub(intent.point, point)) < hypot3(sub(b.point, point))) {
            best = Some(intent);
        }
    }
    best.into_iter().copied().collect()
}

/// Emits the solids of one tree; returns its plate trunk, when it has one.
pub fn emit_tree(
    builder: &mut MeshBuilder,
    tree: &AutoTree,
    contacts: &[ColumnContact],
    s: &SupportSettings,
    hit: Option<Landing>,
    segments: usize,
) -> Option<Column> {
    let geometry = tree_geometry(tree, contacts, s, hit);
    for sphere in &geometry.spheres {
        builder.begin(tag_for(sphere.part, sphere.owner, contacts));
        builder.sphere(sphere.centre, sphere.radius, segments);
        builder.end();
    }
    let pillar_radius = s.pillar_diameter / 2.0;
    for curve in &geometry.curves {
        let mut nodes = curve.nodes.clone();
        if curve.part == Part::TreeBranch && shaped_tip(&s.shape) {
            // Split off the tapered ends (contact tips, a landing on the model) and shape them.
            let first = nodes.iter().position(|n| n.radius >= pillar_radius - 1e-9);
            let last = last_thick(&nodes, pillar_radius);
            if let Some(first) = first.filter(|&f| f > 0 && last >= f as i64) {
                builder.begin(tag_for(Part::Neck, curve.owner, contacts).intents(intent_at(&curve.intents, nodes[0].point)).structure(StructureKind::Tree));
                add_tip(builder, &nodes[..=first], &s.shape, segments);
                builder.end();
                let last = last as usize;
                if last < nodes.len() - 1 {
                    let point = nodes[nodes.len() - 1].point;
                    builder.begin(tag_for(Part::Neck, curve.owner, contacts).intents(intent_at(&curve.intents, point)).structure(StructureKind::Tree));
                    add_tip(builder, &nodes[last..], &s.shape, segments);
                    builder.end();
                }
                nodes = nodes[first..=last].to_vec();
            }
        }
        builder.begin(tag_for(curve.part, curve.owner, contacts).intents(curve.intents.clone()));
        builder.tube(&nodes, segments, None);
        builder.end();
    }
    geometry.trunk
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::policy::{Candidate, CandidateId, Origin};
    use crate::supports::settings::default_values;

    fn contact(x: f64) -> ColumnContact {
        ColumnContact {
            candidate: Candidate { id: CandidateId("c".into()), source_face: Some(1), point: [x, 20.0, 0.0], normal: [0.0, -1.0, 0.0], origin: Origin::Auto },
            shape: None,
            landing: None,
        }
    }

    #[test]
    fn two_leaves_over_the_plate_make_a_trunk_and_a_branch_each() {
        let s = SupportSettings::from_slice(&default_values()).unwrap();
        let contacts = [contact(0.0), contact(1.0)];
        let tree = AutoTree { junction: [0.5, 12.0, 0.0], members: vec![0, 1] };
        let mut builder = MeshBuilder::new();
        let trunk = emit_tree(&mut builder, &tree, &contacts, &s, None, 12).unwrap();
        assert_eq!((trunk.bottom, trunk.top), (s.shape.base_height, 12.0));
        let parts: Vec<Part> = builder.finish().components.iter().map(|c| c.tag.part).collect();
        assert!(parts.contains(&Part::TreeTrunk));
        assert_eq!(parts.iter().filter(|p| **p == Part::TreeBranch).count(), 2);
    }

    #[test]
    fn two_leaves_landing_on_the_model_join_into_one_curve_with_a_secondary_intent() {
        let s = SupportSettings::from_slice(&default_values()).unwrap();
        let contacts = [contact(0.0), contact(1.0)];
        let tree = AutoTree { junction: [0.5, 12.0, 0.0], members: vec![0, 1] };
        let hit = Landing { point: [0.5, 5.0, 0.0], normal: [0.0, 1.0, 0.0], face: Some(7), source_point: None };
        let mut builder = MeshBuilder::new();
        assert!(emit_tree(&mut builder, &tree, &contacts, &s, Some(hit), 12).is_none());
        let mesh = builder.finish();
        let branches: Vec<_> = mesh.components.iter().filter(|c| c.tag.part == Part::TreeBranch).collect();
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].tag.intents.len(), 3);
    }
}
