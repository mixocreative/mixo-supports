//! `build_supports`: the support mesh from placement input (contacts with sampled normals), the
//! model and the settings. Builds columns (tip, neck, pillar, foot), Auto Trees and Braces; Roof,
//! Cage, Raft and Label return the typed `NotYetPorted` error rather than stub geometry (U4c).
//! Landings (where a column or tree meets the model below) are cast here against the model's exact
//! surface; `LandingSource::Supplied` takes them from the caller instead, for the voxel-remeshed
//! surface the TS builder uses outside Low Poly previews (the remesh is U5).

use super::error::{BuildError, Structure};
use super::parts::autotree::auto_tree_layout;
use super::parts::brace::{Column, emit_braces};
use super::parts::builder::MeshBuilder;
use super::parts::column::{ColumnContact, emit_column, emit_feet, neck_bend};
use super::parts::landing::Landing;
use super::parts::model::Model;
use super::parts::tags::Component;
use super::parts::tree::{emit_tree, landing_source};
use super::settings::{PreviewMode, RoofMode, SupportSettings};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildMode {
    Preview,
    Export,
}

/// Where landings come from.
pub enum LandingSource<'a> {
    /// Cast against the model (none without a model).
    Model,
    /// Per-contact landings from `ColumnContact::landing`, and one per Auto Tree in layout order.
    Supplied { trees: &'a [Option<Landing>] },
}

pub struct BuiltSupports {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub components: Vec<Component>,
    /// Indices of automatic contacts left out (zones, landing rules, path decisions): U7. Empty until then.
    pub dropped: Vec<u32>,
}

/// First structure the request needs that this core has not ported, in build order.
fn unported(settings: &SupportSettings, tip_only: bool) -> Option<Structure> {
    if tip_only {
        return None;
    }
    match settings.roof_mode {
        RoofMode::Roof => return Some(Structure::Roof),
        RoofMode::Cage => return Some(Structure::Cage),
        RoofMode::Off => {}
    }
    settings.raft_enabled.then_some(Structure::Raft)
}

pub fn build_supports(
    contacts: &[ColumnContact],
    settings: &SupportSettings,
    mode: BuildMode,
    model: Option<&Model>,
    source: LandingSource,
) -> Result<BuiltSupports, BuildError> {
    let exporting = mode == BuildMode::Export;
    let tip_only = !exporting && settings.preview_mode == PreviewMode::OnlyTip;
    if let Some(structure) = unported(settings, tip_only) {
        return Err(BuildError::NotYetPorted(structure));
    }
    let layout = if settings.scatter_auto_tree { Some(auto_tree_layout(contacts, model, settings)?) } else { None };
    if let (Some(layout), LandingSource::Supplied { trees }) = (&layout, &source) {
        if !tip_only && layout.trees.len() != trees.len() {
            return Err(BuildError::BadInput("tree landings length"));
        }
    }
    let mut builder = MeshBuilder::new();
    let segments = if !exporting && settings.low_poly_mode {
        3.max((settings.resolution / 2.0).round() as usize)
    } else {
        settings.resolution as usize
    };
    let raft_top = if settings.raft_enabled { settings.raft_floor_thickness } else { 0.0 };
    let trees = match &layout {
        Some(layout) if !tip_only => layout.trees.as_slice(),
        _ => &[],
    };
    let mut in_tree = vec![false; contacts.len()];
    for tree in trees {
        for &member in &tree.members {
            in_tree[member] = true;
        }
    }
    let mut anchors = Vec::new();
    for (index, contact) in contacts.iter().enumerate() {
        if in_tree[index] || layout.as_ref().is_some_and(|l| l.removed[index]) {
            continue;
        }
        let landing = match &source {
            LandingSource::Supplied { .. } => contact.landing,
            LandingSource::Model if tip_only => None,
            LandingSource::Model => model.and_then(|m| m.cast_down(neck_bend(contact, &settings.with_shape(contact.shape.as_ref())), m.height)),
        };
        if let Some(anchor) = emit_column(&mut builder, index as u32, contact, settings, raft_top, segments, tip_only, landing) {
            anchors.push(anchor);
        }
    }
    if !tip_only {
        emit_feet(&mut builder, &anchors, settings.pillar_diameter / 2.0, segments);
        let mut columns: Vec<Column> = anchors
            .iter()
            .map(|a| Column { x: a.position[0], z: a.position[2], bottom: a.shape.base_height, top: a.position[1] })
            .collect();
        for (t, tree) in trees.iter().enumerate() {
            let hit = match &source {
                LandingSource::Supplied { trees } => trees[t],
                LandingSource::Model => {
                    let from = landing_source(tree, settings);
                    model.and_then(|m| m.cast_down(from, m.height))
                }
            };
            columns.extend(emit_tree(&mut builder, tree, contacts, settings, hit, segments));
        }
        if settings.truss_enabled {
            emit_braces(&mut builder, &columns, settings, segments);
        }
    }
    let mesh = builder.finish();
    Ok(BuiltSupports { positions: mesh.positions, indices: mesh.indices, components: mesh.components, dropped: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::parts::tags::Part;
    use crate::supports::policy::{Candidate, CandidateId, Origin};
    use crate::supports::settings::{SETTINGS_LAYOUT, default_values};

    fn set(values: &mut [f64], name: &str, value: f64) {
        values[SETTINGS_LAYOUT.iter().position(|n| *n == name).unwrap()] = value;
    }

    fn contacts() -> Vec<ColumnContact> {
        (0..3)
            .map(|k| ColumnContact {
                candidate: Candidate {
                    id: CandidateId(format!("c{k}")),
                    source_face: None,
                    point: [f64::from(k) * 3.0, 8.0, 0.0],
                    normal: [0.0, -1.0, 0.0],
                    origin: Origin::Auto,
                },
                shape: None,
                landing: None,
            })
            .collect()
    }

    fn columns_only() -> SupportSettings {
        let mut values = default_values();
        set(&mut values, "trussEnabled", 0.0);
        set(&mut values, "raftEnabled", 0.0);
        SupportSettings::from_slice(&values).unwrap()
    }

    #[test]
    fn builds_columns_and_orders_components_per_contact_then_feet() {
        let built = build_supports(&contacts(), &columns_only(), BuildMode::Export, None, LandingSource::Model).unwrap();
        let parts: Vec<Part> = built.components.iter().map(|c| c.tag.part).collect();
        assert_eq!(&parts[..2], [Part::Neck, Part::Pillar]);
        assert_eq!(parts.iter().filter(|p| **p == Part::Foot).count(), 3);
        assert_eq!(built.indices.len() % 3, 0);
        assert!(built.dropped.is_empty());
    }

    #[test]
    fn unported_structures_are_typed_errors_not_stubs() {
        let mut values = default_values();
        let err = |values: &[f64]| build_supports(&contacts(), &SupportSettings::from_slice(values).unwrap(), BuildMode::Export, None, LandingSource::Model).err();
        assert_eq!(err(&values), Some(BuildError::NotYetPorted(Structure::Raft)));
        set(&mut values, "raftEnabled", 0.0);
        set(&mut values, "roofMode", 1.0);
        assert_eq!(err(&values), Some(BuildError::NotYetPorted(Structure::Roof)));
        set(&mut values, "roofMode", 2.0);
        assert_eq!(err(&values), Some(BuildError::NotYetPorted(Structure::Cage)));
        set(&mut values, "roofMode", 0.0);
        assert_eq!(err(&values), None);
    }

    #[test]
    fn braces_join_neighbouring_columns_and_trees_replace_their_members() {
        let mut values = default_values();
        set(&mut values, "raftEnabled", 0.0);
        let near: Vec<ColumnContact> = (0..3).map(|k| ColumnContact { candidate: Candidate { point: [f64::from(k) * 4.0, 20.0, 0.0], ..contacts()[0].candidate.clone() }, ..contacts()[0].clone() }).collect();
        let settings = SupportSettings::from_slice(&values).unwrap();
        let built = build_supports(&near, &settings, BuildMode::Export, None, LandingSource::Model).unwrap();
        assert!(built.components.iter().any(|c| c.tag.part == Part::Brace));
        assert!(built.components.iter().all(|c| c.tag.part != Part::Brace || c.tag.contact.is_none()));
        set(&mut values, "scatterAutoTree", 1.0);
        set(&mut values, "scatterMergeDistance", 9.0);
        set(&mut values, "scatterBranchDescent", 1.0);
        let settings = SupportSettings::from_slice(&values).unwrap();
        let treed = build_supports(&near, &settings, BuildMode::Export, None, LandingSource::Model).unwrap();
        assert!(treed.components.iter().any(|c| c.tag.part == Part::TreeTrunk));
        assert!(treed.components.iter().all(|c| c.tag.part != Part::Pillar));
    }

    #[test]
    fn supplied_tree_landings_must_match_the_layout() {
        let mut values = default_values();
        set(&mut values, "raftEnabled", 0.0);
        set(&mut values, "scatterAutoTree", 1.0);
        set(&mut values, "scatterMergeDistance", 5.0);
        set(&mut values, "scatterBranchDescent", 1.0);
        let near: Vec<ColumnContact> = (0..2).map(|k| ColumnContact { candidate: Candidate { point: [f64::from(k) * 2.0, 20.0, 0.0], ..contacts()[0].candidate.clone() }, ..contacts()[0].clone() }).collect();
        let settings = SupportSettings::from_slice(&values).unwrap();
        let err = build_supports(&near, &settings, BuildMode::Export, None, LandingSource::Supplied { trees: &[] }).err();
        assert_eq!(err, Some(BuildError::BadInput("tree landings length")));
        assert!(build_supports(&near, &settings, BuildMode::Export, None, LandingSource::Supplied { trees: &[None] }).is_ok());
    }

    #[test]
    fn tips_only_preview_builds_necks_only() {
        let mut values = default_values();
        set(&mut values, "previewMode", 1.0);
        let settings = SupportSettings::from_slice(&values).unwrap();
        let built = build_supports(&contacts(), &settings, BuildMode::Preview, None, LandingSource::Model).unwrap();
        assert!(built.components.iter().all(|c| c.tag.part == Part::Neck));
    }
}
