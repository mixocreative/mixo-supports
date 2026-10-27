//! Which automatic supports a no-support zone or a landing rule (dental: the secondary contact must
//! land on an approved side) leaves out. The decisions use the same landings the build uses. The
//! host supplies zones as data and a landing rule as flags per column and per tree (`rejected_*`).
//! TODO(U7): the verdict becomes part of the `generate` call.

use super::parts::autotree::AutoTreeLayout;
use super::parts::column::ColumnContact;
use super::parts::landing::Landing;
use super::parts::vec::{normalize_or_down, scale, sub};
use super::settings::SupportSettings;
use super::policy::Origin;
use super::zones::{ZoneStamp, zoned_at};

pub struct OmitInput<'a, 'f> {
    pub contacts: &'a [ColumnContact],
    pub settings: &'a SupportSettings,
    pub tip_only: bool,
    pub layout: Option<&'a AutoTreeLayout>,
    pub zones: &'a [ZoneStamp],
    /// Landing rule: the column of contact `k` / the tree `t` lands where the rule rejects.
    pub rejected_columns: &'a [bool],
    pub rejected_trees: &'a [bool],
    /// Where the column of contact `index` lands on the model (its own shape settings applied).
    pub column_hit: &'f mut dyn FnMut(usize) -> Option<Landing>,
    pub tree_hit: &'f mut dyn FnMut(usize) -> Option<Landing>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Omissions {
    /// Contact indices left out, ascending.
    pub contacts: Vec<u32>,
    /// Layout tree indices left out.
    pub trees: Vec<u32>,
    /// Contact indices left out specifically by a no-support zone, ascending.
    pub by_zones: Vec<u32>,
}

pub fn policy_active(zones: &[ZoneStamp], rejected_columns: &[bool], rejected_trees: &[bool]) -> bool {
    zones.iter().any(|z| z.paint) || rejected_columns.iter().any(|&r| r) || rejected_trees.iter().any(|&r| r)
}

pub fn omissions(input: OmitInput) -> Omissions {
    let OmitInput { contacts, settings, tip_only, layout, zones, rejected_columns, rejected_trees, column_hit, tree_hit } = input;
    let zones_on = zones.iter().any(|z| z.paint);
    let zoned = |landing: &Option<Landing>| zones_on && landing.as_ref().is_some_and(|l| zoned_at(zones, l.point, Some(l.normal)));
    let n = contacts.len();
    let mut dropped = vec![false; n];
    let mut by_zones = vec![false; n];
    let tree_count = layout.map_or(0, |l| l.trees.len());
    let mut blocked = vec![false; tree_count];
    if let Some(layout) = layout {
        for (t, tree) in layout.trees.iter().enumerate() {
            let hit = tree_hit(t);
            if zoned(&hit) {
                for &member in &tree.members {
                    by_zones[member] = true;
                }
                blocked[t] = true;
            } else if hit.is_some() && rejected_trees.get(t).copied().unwrap_or(false) {
                blocked[t] = true;
            }
        }
        for (t, tree) in layout.trees.iter().enumerate() {
            if blocked[t] {
                for &member in &tree.members {
                    dropped[member] = true;
                }
            }
        }
    }
    let mut in_tree = vec![false; n];
    let mut tree_of = vec![false; n];
    if let Some(layout) = layout {
        for (t, tree) in layout.trees.iter().enumerate() {
            for &member in &tree.members {
                in_tree[member] = true;
                if !tip_only && !blocked[t] {
                    tree_of[member] = true;
                }
            }
        }
    }
    let raft_top = if settings.raft_enabled { settings.raft_floor_thickness } else { 0.0 };
    for (index, contact) in contacts.iter().enumerate() {
        if tree_of[index] || layout.is_some_and(|l| l.removed[index]) || dropped[index] {
            continue;
        }
        let own = settings.with_shape(contact.shape.as_ref());
        // A contact whose tip would sit on the raft builds nothing, so it is never judged.
        let tip = sub(contact.candidate.point, scale(normalize_or_down(contact.candidate.normal), own.shape.tip_depth()));
        if tip[1] <= raft_top {
            continue;
        }
        let landing = column_hit(index);
        if contact.candidate.origin != Origin::Manual && !in_tree[index] {
            let is_zoned = zoned(&landing);
            if is_zoned || (landing.is_some() && rejected_columns.get(index).copied().unwrap_or(false)) {
                if is_zoned {
                    by_zones[index] = true;
                }
                dropped[index] = true;
            }
        }
    }
    let indices = |flags: &[bool]| flags.iter().enumerate().filter(|(_, f)| **f).map(|(k, _)| k as u32).collect();
    Omissions { contacts: indices(&dropped), trees: indices(&blocked), by_zones: indices(&by_zones) }
}
