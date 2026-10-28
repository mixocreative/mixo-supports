use super::*;
use crate::supports::parts::column::ContactKind;
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
            kind: ContactKind::default(),
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
    let built = build_supports(&contacts(), &columns_only(), BuildMode::Export, None, LandingSource::Model, &HostChoices::default()).unwrap();
    let parts: Vec<Part> = built.components.iter().map(|c| c.tag.part).collect();
    assert_eq!(&parts[..2], [Part::Neck, Part::Pillar]);
    assert_eq!(parts.iter().filter(|p| **p == Part::Foot).count(), 3);
    assert_eq!(built.indices.len() % 3, 0);
    assert!(built.dropped.is_empty());
}

#[test]
fn raft_label_roof_and_cage_build_from_the_column_feet_without_a_model() {
    let mut values = default_values();
    let build = |values: &[f64], text: &str| {
        let host = HostChoices { label_text: text, ..HostChoices::default() };
        build_supports(&contacts(), &SupportSettings::from_slice(values).unwrap(), BuildMode::Export, None, LandingSource::Model, &host).unwrap()
    };
    let parts = |built: &BuiltSupports| built.components.iter().map(|c| c.tag.part).collect::<Vec<_>>();
    assert!(parts(&build(&values, "A1")).contains(&Part::Raft));
    assert!(parts(&build(&values, "A1")).contains(&Part::Label));
    assert!(!parts(&build(&values, "")).contains(&Part::Label));
    set(&mut values, "raftEnabled", 0.0);
    assert!(!parts(&build(&values, "A")).contains(&Part::Raft));
    set(&mut values, "roofMode", 2.0);
    // Roof and Cage stand on the raft outline, which needs a model.
    assert!(!parts(&build(&values, "A")).contains(&Part::CageRing));
}

#[test]
fn zones_leave_out_the_columns_that_land_in_them_and_report_them() {
    let zone = AreaStamp { center: [3.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], radius: 1.0, allow: true };
    let host = HostChoices { zones: &[zone], ..HostChoices::default() };
    let plate = |host: &HostChoices| build_supports(&contacts(), &columns_only(), BuildMode::Export, None, LandingSource::Model, host).unwrap();
    // Without a model nothing lands on it, so nothing is zoned.
    assert!(plate(&host).dropped.is_empty());
    // A landing rule needs a landing to judge: without a model nothing is rejected.
    let deny = |_: &Landing| false;
    let strict = HostChoices { landing_allowed: Some(&deny), ..HostChoices::default() };
    assert!(plate(&strict).dropped.is_empty());
}

#[test]
fn braces_join_neighbouring_columns_and_trees_replace_their_members() {
    let mut values = default_values();
    set(&mut values, "raftEnabled", 0.0);
    let near: Vec<ColumnContact> = (0..3).map(|k| ColumnContact { candidate: Candidate { point: [f64::from(k) * 4.0, 20.0, 0.0], ..contacts()[0].candidate.clone() }, ..contacts()[0].clone() }).collect();
    let settings = SupportSettings::from_slice(&values).unwrap();
    let built = build_supports(&near, &settings, BuildMode::Export, None, LandingSource::Model, &HostChoices::default()).unwrap();
    assert!(built.components.iter().any(|c| c.tag.part == Part::Brace));
    assert!(built.components.iter().all(|c| c.tag.part != Part::Brace || c.tag.contact.is_none()));
    set(&mut values, "scatterAutoTree", 1.0);
    set(&mut values, "scatterMergeDistance", 9.0);
    set(&mut values, "scatterBranchDescent", 1.0);
    let settings = SupportSettings::from_slice(&values).unwrap();
    let treed = build_supports(&near, &settings, BuildMode::Export, None, LandingSource::Model, &HostChoices::default()).unwrap();
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
    let err = build_supports(&near, &settings, BuildMode::Export, None, LandingSource::Supplied { trees: &[] }, &HostChoices::default()).err();
    assert_eq!(err, Some(BuildError::BadInput("tree landings length")));
    assert!(build_supports(&near, &settings, BuildMode::Export, None, LandingSource::Supplied { trees: &[None] }, &HostChoices::default()).is_ok());
}

#[test]
fn tips_only_preview_builds_necks_only() {
    let mut values = default_values();
    set(&mut values, "previewMode", 1.0);
    let settings = SupportSettings::from_slice(&values).unwrap();
    let built = build_supports(&contacts(), &settings, BuildMode::Preview, None, LandingSource::Model, &HostChoices::default()).unwrap();
    assert!(built.components.iter().all(|c| c.tag.part == Part::Neck));
}
