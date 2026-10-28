//! The manual edit model of a unit: final contacts are the automatic ones minus the exact deleted
//! IDs, plus every manual addition. Deleted IDs and per-support settings follow a fresh placement by
//! ID (an automatic ID encodes its position on a 0.01 mm grid), so a deletion keeps hiding the same
//! spot after any regeneration. Manual contacts are never hidden or moved by a removal.

use super::contact_id::{position_from_id, position_id};
use crate::core::jsnum::hypot3;
use std::collections::{HashMap, HashSet};

/// A contact as the edit model sees it: its ID and where it stands.
#[derive(Clone, Debug, PartialEq)]
pub struct EditPoint {
    pub id: String,
    pub position: [f64; 3],
}

/// Indices into `auto` that stay (not deleted), then every index of `manual`, as (is_manual, index).
pub fn compose_contacts(auto_ids: &[&str], manual_count: usize, deleted: &[String]) -> Vec<(bool, usize)> {
    let gone: HashSet<&str> = deleted.iter().map(String::as_str).collect();
    let mut out: Vec<(bool, usize)> = auto_ids.iter().enumerate().filter(|(_, id)| !gone.contains(**id)).map(|(k, _)| (false, k)).collect();
    out.extend((0..manual_count).map(|k| (true, k)));
    out
}

/// The `deleted` IDs that hide an automatic contact right now (each once, in order); one whose spot
/// is gone hides nothing.
pub fn hiding_removals(auto_ids: &[&str], deleted: &[String]) -> Vec<String> {
    let ids: HashSet<&str> = auto_ids.iter().copied().collect();
    let mut seen = HashSet::new();
    deleted.iter().filter(|id| ids.contains(id.as_str()) && seen.insert(id.as_str())).cloned().collect()
}

/// The new contact each stored ID names after a fresh placement: itself when a new contact has it,
/// else the nearest new contact within `match_radius` of its encoded spot that no earlier ID (or exact
/// match) claimed. IDs with no match are absent.
fn match_ids(stored: &[String], points: &[EditPoint], match_radius: f64) -> HashMap<String, String> {
    let ids: HashSet<&str> = points.iter().map(|p| p.id.as_str()).collect();
    let mut claimed: HashSet<String> = stored.iter().filter(|id| ids.contains(id.as_str())).cloned().collect();
    let mut matched: HashMap<String, String> = HashMap::new();
    for id in stored {
        if matched.contains_key(id) {
            continue;
        }
        if claimed.contains(id) {
            matched.insert(id.clone(), id.clone());
            continue;
        }
        let mut nearest: Option<&EditPoint> = None;
        let mut nearest_distance = match_radius;
        if let Some(target) = position_from_id(id) {
            for point in points {
                if claimed.contains(&point.id) {
                    continue;
                }
                let d = hypot3([target[0] - point.position[0], target[1] - point.position[1], target[2] - point.position[2]]);
                if d < nearest_distance {
                    nearest = Some(point);
                    nearest_distance = d;
                }
            }
        }
        if let Some(point) = nearest {
            claimed.insert(point.id.clone());
            matched.insert(id.clone(), point.id.clone());
        }
    }
    matched
}

fn unique(ids: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.into_iter().filter(|id| seen.insert(id.clone())).collect()
}

/// Re-keys removed IDs for a fresh placement: an ID that names a new contact stays; one that does not
/// becomes the ID of the nearest still-unclaimed new contact within `match_radius` of its encoded
/// spot; one with no such neighbour is kept, in case a later placement samples that spot again.
pub fn remap_deleted(deleted: &[String], points: &[EditPoint], match_radius: f64) -> Vec<String> {
    let matched = match_ids(deleted, points, match_radius);
    unique(deleted.iter().map(|id| matched.get(id).cloned().unwrap_or_else(|| id.clone())))
}

/// What a fresh placement made of a unit's hand work, with the counts the Regenerate report gives.
#[derive(Debug, PartialEq, Eq)]
pub struct RekeyedHandWork {
    /// The removals re-keyed; one no new contact matches is dropped (and counted in `removals_reset`).
    pub deleted: Vec<String>,
    /// For each per-support settings ID in the input order, the ID it now belongs to (manual IDs stay).
    pub override_targets: Vec<Option<String>>,
    pub removals_kept: usize,
    pub removals_reset: usize,
    pub customised_kept: usize,
    pub customised_reset: usize,
}

/// Follows a fresh placement with the unit's removals and per-support settings in one match, so a
/// new contact is claimed by one of them at most. A removal or a setting no new contact matches is
/// dropped and counted, so nothing stays stored for an ID that names no support.
pub fn rekey_hand_work(deleted: &[String], override_ids: &[String], manual_ids: &HashSet<String>, points: &[EditPoint], match_radius: f64) -> RekeyedHandWork {
    let automatic: Vec<String> = override_ids.iter().filter(|id| !manual_ids.contains(*id)).cloned().collect();
    let stored: Vec<String> = deleted.iter().cloned().chain(automatic).collect();
    let matched = match_ids(&stored, points, match_radius);
    let override_targets: Vec<Option<String>> =
        override_ids.iter().map(|id| if manual_ids.contains(id) { Some(id.clone()) } else { matched.get(id).cloned() }).collect();
    let removals: HashSet<&String> = deleted.iter().collect();
    let removals_kept = removals.iter().filter_map(|id| matched.get(*id)).collect::<HashSet<_>>().len();
    let customised_kept = override_targets.iter().flatten().collect::<HashSet<_>>().len();
    RekeyedHandWork {
        deleted: unique(deleted.iter().filter_map(|id| matched.get(id).cloned())),
        override_targets,
        removals_kept,
        removals_reset: removals.len() - removals_kept,
        customised_kept,
        customised_reset: override_ids.iter().collect::<HashSet<_>>().len() - customised_kept,
    }
}

/// Gives every automatic contact the ID its stored position encodes (a non-automatic ID stays).
pub fn rekey_ids(points: &[EditPoint]) -> Vec<String> {
    points.iter().map(|p| if position_from_id(&p.id).is_some() { position_id(p.position) } else { p.id.clone() }).collect()
}

/// The automatic contacts an old radius removal hid: those named by a marker, plus every one within
/// `erase_radius` of a marker's encoded spot. Only the one-time load migration of the retired
/// `suppressed` list uses it.
pub fn contacts_hidden_by_markers(auto: &[EditPoint], markers: &[String], erase_radius: f64) -> Vec<String> {
    let named: HashSet<&str> = markers.iter().map(String::as_str).collect();
    let spots: Vec<[f64; 3]> = if erase_radius > 0.0 { markers.iter().filter_map(|m| position_from_id(m)).collect() } else { Vec::new() };
    auto.iter()
        .filter(|p| named.contains(p.id.as_str()) || spots.iter().any(|s| hypot3([s[0] - p.position[0], s[1] - p.position[1], s[2] - p.position[2]]) < erase_radius))
        .map(|p| p.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(id: &str, x: f64) -> EditPoint {
        EditPoint { id: id.into(), position: [x, 0.0, 0.0] }
    }

    #[test]
    fn deleted_ids_hide_only_automatic_contacts_and_manual_ones_always_stay() {
        let composed = compose_contacts(&["auto-0_0_0", "auto-100_0_0"], 1, &["auto-0_0_0".into(), "manual-1".into()]);
        assert_eq!(composed, vec![(false, 1), (true, 0)]);
        assert_eq!(hiding_removals(&["auto-0_0_0"], &["auto-0_0_0".into(), "auto-0_0_0".into(), "auto-5_0_0".into()]), vec!["auto-0_0_0".to_string()]);
    }

    #[test]
    fn a_removal_follows_the_nearest_unclaimed_new_contact_within_the_radius() {
        let points = [point("auto-110_0_0", 1.1), point("auto-500_0_0", 5.0)];
        assert_eq!(remap_deleted(&["auto-100_0_0".into(), "auto-900_0_0".into()], &points, 0.5), vec!["auto-110_0_0", "auto-900_0_0"]);
        let work = rekey_hand_work(&["auto-100_0_0".into(), "auto-900_0_0".into()], &["auto-500_0_0".into(), "manual-1".into(), "auto-7000_0_0".into()], &HashSet::from(["manual-1".to_string()]), &points, 0.5);
        assert_eq!(work.deleted, vec!["auto-110_0_0"]);
        assert_eq!(work.override_targets, vec![Some("auto-500_0_0".into()), Some("manual-1".into()), None]);
        assert_eq!((work.removals_kept, work.removals_reset, work.customised_kept, work.customised_reset), (1, 1, 2, 1));
    }

    #[test]
    fn markers_hide_by_name_and_by_radius() {
        let auto = [point("auto-0_0_0", 0.0), point("auto-100_0_0", 1.0), point("auto-900_0_0", 9.0)];
        assert_eq!(contacts_hidden_by_markers(&auto, &["auto-20_0_0".into()], 1.0), vec!["auto-0_0_0", "auto-100_0_0"]);
        assert_eq!(contacts_hidden_by_markers(&auto, &["auto-900_0_0".into()], 0.0), vec!["auto-900_0_0"]);
    }
}
