//! Auto Tree layout as SLASG_VertexScatter_Mixo builds it, followed by MIXO_ManualPoints (port of
//! TS `autoTreeLayout`, exact-model path). Contacts that may branch cluster by Merge Distance; each
//! cluster of two or more gets a junction below its members, snapped onto the model.
//! With a model and Safe Distance != 0 TS scans a voxel remesh (U5): that is a typed error here.

use super::column::ColumnContact;
use super::model::{Model, hypot3};
use super::vec::{V3, add, sub};
use crate::supports::error::{BuildError, Structure};
use crate::supports::policy::Origin;
use crate::supports::settings::SupportSettings;

#[derive(Clone, Debug, PartialEq)]
pub struct AutoTree {
    pub junction: V3,
    /// Contact indices, ascending.
    pub members: Vec<usize>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AutoTreeLayout {
    pub trees: Vec<AutoTree>,
    /// Contacts the scatter deletes (welded into a junction): they build nothing.
    pub removed: Vec<bool>,
}

fn mean(points: &[V3]) -> V3 {
    let sum = points.iter().fold([0.0; 3], |total, &p| add(total, p));
    [sum[0] / points.len() as f64, sum[1] / points.len() as f64, sum[2] / points.len() as f64]
}

pub fn auto_tree_layout(contacts: &[ColumnContact], model: Option<&Model>, s: &SupportSettings) -> Result<AutoTreeLayout, BuildError> {
    let spacing = s.scatter_spacing;
    let has_faces = model.is_some_and(|m| m.face_count() > 0);
    if model.is_some() && s.scatter_safe_distance != 0.0 {
        return Err(BuildError::NotYetPorted(Structure::Tree));
    }
    let limit = s.scatter_angle * std::f64::consts::PI / 180.0;
    let position = |k: usize| contacts[k].candidate.point;
    let mut removed = vec![false; contacts.len()];
    let eligible: Vec<bool> = contacts
        .iter()
        .map(|contact| {
            let p = contact.candidate.point;
            let from = [p[0], p[1] - spacing / 32.0, p[2]];
            contact.candidate.origin != Origin::Manual && contact.shape.is_none() && !model.is_some_and(|m| m.hits_blocker_below(from, p[1], limit))
        })
        .collect();
    let mut assigned: Vec<bool> = (0..contacts.len()).map(|k| !eligible[k]).collect();
    let mut clusters: Vec<(Vec<usize>, V3)> = Vec::new();
    for seed in 0..contacts.len() {
        if assigned[seed] {
            continue;
        }
        let mut members = Vec::new();
        for other in 0..contacts.len() {
            if !assigned[other] && hypot3(sub(position(seed), position(other))) <= s.scatter_merge_distance {
                assigned[other] = true;
                members.push(other);
            }
        }
        if members.len() < 2 {
            continue;
        }
        let average = mean(&members.iter().map(|&k| position(k)).collect::<Vec<_>>());
        clusters.push((members, average));
    }
    // The Spacing/16 clean-up merge welds every point within reach of a junction into it.
    for (_, average) in &mut clusters {
        let welded: Vec<usize> = (0..contacts.len()).filter(|&k| !removed[k] && hypot3(sub(position(k), *average)) <= spacing / 16.0).collect();
        if welded.is_empty() {
            continue;
        }
        let mut points = vec![*average];
        points.extend(welded.iter().map(|&k| position(k)));
        *average = mean(&points);
        for k in welded {
            removed[k] = true;
        }
    }
    let mut trees = Vec::new();
    for (members, average) in clusters {
        let members: Vec<usize> = members.into_iter().filter(|&k| !removed[k]).collect();
        if members.is_empty() {
            continue;
        }
        let reach = members.iter().map(|&k| (position(k)[0] - average[0]).hypot(position(k)[2] - average[2])).fold(f64::NEG_INFINITY, f64::max);
        let y = average[1] - s.scatter_branch_descent - 2.0 * reach;
        if y < spacing {
            continue;
        }
        let junction = [average[0], y, average[2]];
        trees.push(AutoTree { junction: if has_faces { model.unwrap().closest_point(junction) } else { junction }, members });
    }
    Ok(AutoTreeLayout { trees, removed })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supports::policy::{Candidate, CandidateId};
    use crate::supports::settings::default_values;

    fn contact(x: f64, y: f64, origin: Origin) -> ColumnContact {
        ColumnContact { candidate: Candidate { id: CandidateId("c".into()), source_face: None, point: [x, y, 0.0], normal: [0.0, -1.0, 0.0], origin }, shape: None, landing: None }
    }

    #[test]
    fn nearby_auto_contacts_form_a_tree_and_manual_ones_never_join() {
        let s = SupportSettings::from_slice(&default_values()).unwrap();
        let contacts = [contact(0.0, 20.0, Origin::Auto), contact(0.6, 20.0, Origin::Auto), contact(0.3, 20.0, Origin::Manual), contact(40.0, 20.0, Origin::Auto)];
        let layout = auto_tree_layout(&contacts, None, &s).unwrap();
        assert_eq!(layout.trees.len(), 1);
        assert_eq!(layout.trees[0].members, [0, 1]);
        assert!(layout.trees[0].junction[1] < 20.0);
    }
}
