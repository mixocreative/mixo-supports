//! `build_supports`: the support mesh from placement input supplied by the caller. U4a builds
//! columns only (tip, neck, pillar, foot); Tree, Brace, Roof, Cage, Raft and Label return the
//! typed `NotYetPorted` error rather than stub geometry (U4b, U4c).

use super::error::{BuildError, Structure};
use super::parts::builder::MeshBuilder;
use super::parts::column::{ColumnContact, emit_column, emit_feet};
use super::parts::tags::Component;
use super::settings::{PreviewMode, RoofMode, SupportSettings};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildMode {
    Preview,
    Export,
}

pub struct BuiltSupports {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub components: Vec<Component>,
    /// Indices of automatic contacts left out (zones, landing rules, path decisions): U7. Empty in U4a.
    pub dropped: Vec<u32>,
}

/// First structure the request needs that this core has not ported, in build order.
fn unported(settings: &SupportSettings, tip_only: bool) -> Option<Structure> {
    // Auto Tree changes which contacts become columns, so it matters even in a tips-only preview.
    if settings.scatter_auto_tree {
        return Some(Structure::Tree);
    }
    if tip_only {
        return None;
    }
    if settings.truss_enabled {
        return Some(Structure::Brace);
    }
    match settings.roof_mode {
        RoofMode::Roof => return Some(Structure::Roof),
        RoofMode::Cage => return Some(Structure::Cage),
        RoofMode::Off => {}
    }
    settings.raft_enabled.then_some(Structure::Raft)
}

pub fn build_supports(contacts: &[ColumnContact], settings: &SupportSettings, mode: BuildMode) -> Result<BuiltSupports, BuildError> {
    let exporting = mode == BuildMode::Export;
    let tip_only = !exporting && settings.preview_mode == PreviewMode::OnlyTip;
    if let Some(structure) = unported(settings, tip_only) {
        return Err(BuildError::NotYetPorted(structure));
    }
    let mut builder = MeshBuilder::new();
    let segments = if !exporting && settings.low_poly_mode {
        3.max((settings.resolution / 2.0).round() as usize)
    } else {
        settings.resolution as usize
    };
    let raft_top = if settings.raft_enabled { settings.raft_floor_thickness } else { 0.0 };
    let mut anchors = Vec::new();
    for (index, contact) in contacts.iter().enumerate() {
        if let Some(anchor) = emit_column(&mut builder, index as u32, contact, settings, raft_top, segments, tip_only) {
            anchors.push(anchor);
        }
    }
    if !tip_only {
        emit_feet(&mut builder, &anchors, settings.pillar_diameter / 2.0, segments);
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
        let built = build_supports(&contacts(), &columns_only(), BuildMode::Export).unwrap();
        let parts: Vec<Part> = built.components.iter().map(|c| c.tag.part).collect();
        assert_eq!(&parts[..2], [Part::Neck, Part::Pillar]);
        assert_eq!(parts.iter().filter(|p| **p == Part::Foot).count(), 3);
        assert_eq!(built.indices.len() % 3, 0);
        assert!(built.dropped.is_empty());
    }

    #[test]
    fn unported_structures_are_typed_errors_not_stubs() {
        let mut values = default_values();
        let err = |values: &[f64]| build_supports(&contacts(), &SupportSettings::from_slice(values).unwrap(), BuildMode::Export).err();
        assert_eq!(err(&values), Some(BuildError::NotYetPorted(Structure::Brace)));
        set(&mut values, "trussEnabled", 0.0);
        assert_eq!(err(&values), Some(BuildError::NotYetPorted(Structure::Raft)));
        set(&mut values, "raftEnabled", 0.0);
        set(&mut values, "roofMode", 1.0);
        assert_eq!(err(&values), Some(BuildError::NotYetPorted(Structure::Roof)));
        set(&mut values, "roofMode", 0.0);
        set(&mut values, "scatterAutoTree", 1.0);
        assert_eq!(err(&values), Some(BuildError::NotYetPorted(Structure::Tree)));
    }

    #[test]
    fn tips_only_preview_builds_necks_only() {
        let mut values = default_values();
        set(&mut values, "previewMode", 1.0);
        let settings = SupportSettings::from_slice(&values).unwrap();
        let built = build_supports(&contacts(), &settings, BuildMode::Preview).unwrap();
        assert!(built.components.iter().all(|c| c.tag.part == Part::Neck));
    }
}
