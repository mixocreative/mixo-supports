//! `build_supports`: the support mesh from placement input (contacts), the model and the settings.
//! Builds columns (tip, neck, pillar, foot), Auto Trees, Braces, the raft with its letter label, and
//! Roof / Cage. Landings (where a column or tree meets the model below) and neck normals come from
//! the line target (`LandingSource::Target`: exact surface, then the voxel remesh unless it is a Low
//! Poly preview), from the exact surface alone (`Model`), or from the caller (`Supplied`, parity
//! harness only). Zones and the landing rule leave contacts and trees out (`omit`).

use super::error::BuildError;
use super::line_target::LineTarget;
use super::omit::{OmitInput, Omissions, omissions, policy_active};
use super::parts::autotree::{AutoTreeLayout, auto_tree_layout};
use super::parts::brace::{Column, emit_braces};
use super::parts::builder::MeshBuilder;
use super::parts::column::{ColumnContact, emit_column, emit_feet, neck_bend};
use super::parts::landing::Landing;
use super::parts::model::Model;
use super::parts::tags::Component;
use super::parts::tree::{emit_tree, landing_source};
use super::parts::structures::emit_structures;
use super::settings::{PreviewMode, SupportSettings};
use super::zones::ZoneStamp;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildMode {
    Preview,
    Export,
}

/// Where landings and neck normals come from.
pub enum LandingSource<'a> {
    /// Cast against the model's exact surface (none without a model); normals as given.
    Model,
    /// The line target: exact surface, then the voxel remesh (production).
    Target,
    /// Per-contact landings from `ColumnContact::landing`, and one per Auto Tree in layout order.
    Supplied { trees: &'a [Option<Landing>] },
}

pub struct BuiltSupports {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub components: Vec<Component>,
    /// Indices of automatic contacts left out (zones, landing rules): ascending.
    pub dropped: Vec<u32>,
    /// The subset of `dropped` a no-support zone caused.
    pub dropped_by_zones: Vec<u32>,
}

/// What the host decided that this core does not compute: the label text, the no-support zones and
/// the landing rule as flags per column / per tree (the host evaluates it on `probe_landings`).
#[derive(Default)]
pub struct HostChoices<'a> {
    pub label_text: &'a str,
    pub zones: &'a [ZoneStamp],
    pub rejected_columns: &'a [bool],
    pub rejected_trees: &'a [bool],
}

/// Where the columns and trees land, for a host landing rule.
pub struct LandingProbe {
    pub layout: Option<AutoTreeLayout>,
    pub columns: Vec<Option<Landing>>,
    pub trees: Vec<Option<Landing>>,
}

struct Prepared<'m, 'a> {
    contacts: Vec<ColumnContact>,
    settings: &'a SupportSettings,
    exporting: bool,
    tip_only: bool,
    model: Option<&'m Model<'m>>,
    target: Option<LineTarget<'m>>,
    layout: Option<AutoTreeLayout>,
    source: &'a LandingSource<'a>,
}

impl<'m, 'a> Prepared<'m, 'a> {
    fn new(contacts: &[ColumnContact], settings: &'a SupportSettings, mode: BuildMode, model: Option<&'m Model<'m>>, source: &'a LandingSource<'a>) -> Result<Self, BuildError> {
        let exporting = mode == BuildMode::Export;
        let tip_only = !exporting && settings.preview_mode == PreviewMode::OnlyTip;
        let target = match (source, model) {
            (LandingSource::Target, Some(m)) => Some(LineTarget::new(m, settings, exporting)),
            _ => None,
        };
        let mut contacts = contacts.to_vec();
        if let Some(target) = &target {
            for contact in &mut contacts {
                contact.candidate.normal = target.normal(contact);
            }
        }
        let layout = if settings.scatter_auto_tree { Some(auto_tree_layout(&contacts, model, settings)?) } else { None };
        if let (Some(layout), LandingSource::Supplied { trees }) = (&layout, source) {
            if !tip_only && layout.trees.len() != trees.len() {
                return Err(BuildError::BadInput("tree landings length"));
            }
        }
        Ok(Self { contacts, settings, exporting, tip_only, model, target, layout, source })
    }

    fn cast(&self, from: [f64; 3]) -> Option<Landing> {
        match (&self.target, self.model) {
            (Some(target), _) => target.cast(from, target.height()),
            (None, Some(m)) => m.cast_down(from, m.height),
            _ => None,
        }
    }

    /// Where the column of contact `index` lands (its own shape applied), whether or not it is built.
    fn column_landing(&self, index: usize) -> Option<Landing> {
        let contact = &self.contacts[index];
        match self.source {
            LandingSource::Supplied { .. } => contact.landing,
            _ => self.cast(neck_bend(contact, &self.settings.with_shape(contact.shape.as_ref()))),
        }
    }

    fn tree_landing(&self, t: usize) -> Option<Landing> {
        let tree = &self.layout.as_ref()?.trees[t];
        match self.source {
            LandingSource::Supplied { trees } => trees.get(t).copied().flatten(),
            _ => self.cast(landing_source(tree, self.settings)),
        }
    }
}

pub fn probe_landings(contacts: &[ColumnContact], settings: &SupportSettings, mode: BuildMode, model: Option<&Model>, source: LandingSource) -> Result<LandingProbe, BuildError> {
    let prepared = Prepared::new(contacts, settings, mode, model, &source)?;
    let columns = (0..prepared.contacts.len()).map(|k| prepared.column_landing(k)).collect();
    let trees = (0..prepared.layout.as_ref().map_or(0, |l| l.trees.len())).map(|t| prepared.tree_landing(t)).collect();
    Ok(LandingProbe { layout: prepared.layout, columns, trees })
}

pub fn build_supports(
    contacts: &[ColumnContact],
    settings: &SupportSettings,
    mode: BuildMode,
    model: Option<&Model>,
    source: LandingSource,
    host: &HostChoices,
) -> Result<BuiltSupports, BuildError> {
    let prepared = Prepared::new(contacts, settings, mode, model, &source)?;
    let Prepared { exporting, tip_only, .. } = prepared;
    let contacts = &prepared.contacts;
    let layout = &prepared.layout;
    if [host.rejected_columns.len(), host.rejected_trees.len()].iter().any(|&n| n != 0) && (host.rejected_columns.len() != contacts.len() || host.rejected_trees.len() != layout.as_ref().map_or(0, |l| l.trees.len())) {
        return Err(BuildError::BadInput("landing rule flags length"));
    }
    let omitted = if policy_active(host.zones, host.rejected_columns, host.rejected_trees) {
        let mut column_cache: Vec<Option<Option<Landing>>> = vec![None; contacts.len()];
        let mut tree_cache: Vec<Option<Option<Landing>>> = vec![None; layout.as_ref().map_or(0, |l| l.trees.len())];
        let mut column_hit = |k: usize| *column_cache[k].get_or_insert_with(|| prepared.column_landing(k));
        let mut tree_hit = |t: usize| *tree_cache[t].get_or_insert_with(|| prepared.tree_landing(t));
        omissions(OmitInput {
            contacts, settings, tip_only, layout: layout.as_ref(), zones: host.zones,
            rejected_columns: host.rejected_columns, rejected_trees: host.rejected_trees,
            column_hit: &mut column_hit, tree_hit: &mut tree_hit,
        })
    } else {
        Omissions::default()
    };
    let mut omit = vec![false; contacts.len()];
    for &k in &omitted.contacts {
        omit[k as usize] = true;
    }
    let mut omit_tree = vec![false; layout.as_ref().map_or(0, |l| l.trees.len())];
    for &t in &omitted.trees {
        omit_tree[t as usize] = true;
    }
    let mut builder = MeshBuilder::new();
    let segments = if !exporting && settings.low_poly_mode {
        3.max((settings.resolution / 2.0).round() as usize)
    } else {
        settings.resolution as usize
    };
    let raft_top = if settings.raft_enabled { settings.raft_floor_thickness } else { 0.0 };
    // Indices into the layout of the trees that are built (all trees but the omitted ones; none in a tips-only preview).
    let built_trees: Vec<usize> = match layout {
        Some(layout) if !tip_only => (0..layout.trees.len()).filter(|&t| !omit_tree[t]).collect(),
        _ => Vec::new(),
    };
    let mut in_tree = vec![false; contacts.len()];
    if let Some(layout) = layout {
        for &t in &built_trees {
            for &member in &layout.trees[t].members {
                in_tree[member] = true;
            }
        }
    }
    let mut anchors = Vec::new();
    for (index, contact) in contacts.iter().enumerate() {
        if in_tree[index] || layout.as_ref().is_some_and(|l| l.removed[index]) || omit[index] {
            continue;
        }
        let landing = if tip_only { None } else { prepared.column_landing(index) };
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
        for &t in &built_trees {
            let tree = &layout.as_ref().expect("built trees need a layout").trees[t];
            let hit = prepared.tree_landing(t);
            columns.extend(emit_tree(&mut builder, tree, contacts, settings, hit, segments));
        }
        if settings.truss_enabled {
            emit_braces(&mut builder, &columns, settings, segments);
        }
        let footprints: Vec<[f64; 2]> = columns.iter().map(|c| [c.x, c.z]).collect();
        emit_structures(&mut builder, &footprints, settings, prepared.model, host.label_text);
    }
    let mesh = builder.finish();
    Ok(BuiltSupports { positions: mesh.positions, indices: mesh.indices, components: mesh.components, dropped: omitted.contacts, dropped_by_zones: omitted.by_zones })
}

#[cfg(test)]
mod tests;
