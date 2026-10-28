use super::*;
use crate::supports::error::BuildError;


#[test]
fn defaults_parse_and_layout_has_no_duplicates() {
    let values = default_values();
    assert_eq!(values.len(), SETTINGS_LAYOUT.len());
    let settings = SupportSettings::from_slice(&values).unwrap();
    assert_eq!(settings.pillar_diameter, 0.8);
    assert_eq!(settings.resolution, 12.0);
    assert!(settings.raft_enabled && settings.truss_enabled && settings.label_enabled);
    assert!((settings.tip_radius() - 0.1).abs() < 1e-12);
    let mut names = SETTINGS_LAYOUT.to_vec();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), SETTINGS_LAYOUT.len());
}

#[test]
fn out_of_range_and_non_finite_are_typed_errors() {
    let mut values = default_values();
    values[4] = 5.0; // tipCrossWidth below 10
    assert_eq!(SupportSettings::from_slice(&values), Err(BuildError::SettingOutOfRange("tipCrossWidth")));
    let mut values = default_values();
    values[11] = f64::NAN;
    assert_eq!(SupportSettings::from_slice(&values), Err(BuildError::SettingOutOfRange("pillarDiameter")));
    assert_eq!(SupportSettings::from_slice(&[1.0]), Err(BuildError::BadInput("settings length")));
}

#[test]
fn shape_override_keeps_base_for_nan() {
    let base = SupportSettings::from_slice(&default_values()).unwrap().shape;
    let mut over = vec![f64::NAN; SHAPE_LAYOUT.len()];
    over[0] = 1.0; // sphere
    over[5] = 0.9; // touchDiameter
    let shaped = ShapeSettings::overridden(&base, &over).unwrap();
    assert_eq!(shaped.contact_shape, ContactShape::Sphere);
    assert_eq!(shaped.touch_diameter, 0.9);
    assert_eq!(shaped.neck_length, base.neck_length);
}
