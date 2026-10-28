//! The plate structures built after the columns (port of TS `addStructures`): raft, its letter
//! label, and Roof / Cage on the raft's raw perimeter. The raft follows the model's outline; without
//! a model it follows the column feet.

use super::builder::MeshBuilder;
use super::label::emit_label;
use super::model::Model;
use super::plan::{P2, corner_bisectors};
use super::raft::{emit_raft, footprint_ring, label_candidates};
use super::raft_outline::{RaftLoop, raft_outline};
use super::roof::{build_roof_cage, emit_roof_cage};
use crate::supports::settings::{RoofMode, SupportSettings};

pub fn emit_structures(builder: &mut MeshBuilder, footprints: &[P2], s: &SupportSettings, model: Option<&Model>, label_text: &str) {
    // Roof / Cage: Resin UV sends Expand Width >= Gap To Model + column radius and at least 64
    // voxels, and SLASG's intermediate raft pushes the floor out by Column diameter.
    let roof = s.roof_mode != RoofMode::Off;
    let expand = if roof { s.raft_expand_width.max(s.cage_side_gap + s.column_diameter / 2.0) } else { s.raft_expand_width };
    let voxels = if roof { s.voxel_resolution.max(64.0) } else { s.voxel_resolution };
    let outline = model.map(|m| raft_outline(m.positions(), m.indices(), expand, voxels as usize));

    let grown = |polygon: &[P2]| -> Vec<P2> {
        if !roof {
            return polygon.to_vec();
        }
        let bisectors = corner_bisectors(polygon);
        polygon.iter().enumerate().map(|(i, p)| [p[0] - bisectors[i][0] * s.column_diameter, p[1] - bisectors[i][1] * s.column_diameter]).collect()
    };
    // Parts set apart from the largest each get their own raft (and roof/cage); the letter label
    // stays on the largest.
    let others: Vec<&RaftLoop> = outline.iter().flat_map(|o| o.others.iter()).filter(|l| l.polygon.len() >= 3).collect();
    if s.raft_enabled {
        let floor = match &outline {
            Some(o) if o.main.polygon.len() >= 3 => grown(&o.main.polygon),
            _ => grown(&footprint_ring(footprints, expand)),
        };
        if floor.len() < 3 {
            return;
        }
        emit_raft(builder, &floor, s);
        if s.label_enabled && !label_text.is_empty() {
            emit_label(builder, &label_candidates(&floor, s), s, label_text);
        }
        for l in &others {
            emit_raft(builder, &grown(&l.polygon), s);
        }
    }

    let (Some(outline), Some(model)) = (&outline, model) else { return };
    if !roof {
        return;
    }
    // Built at plate height 0 and raised onto the plate by the caller, so the top is measured from it.
    let top = model.top() - s.plate_y;
    for l in std::iter::once(&outline.main).chain(others.iter().copied()) {
        emit_roof_cage(builder, &build_roof_cage(&l.raw, top, s));
    }
}
