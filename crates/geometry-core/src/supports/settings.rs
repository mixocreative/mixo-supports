//! Support settings as plain numbers, mirroring the validated TypeScript `LiveSupportSettings`
//! (src/core/supports/settings.ts). The host validates and sends one flat f64 array in
//! `SETTINGS_LAYOUT` order; Rust re-checks every limit and returns a typed error, never clamps.
//! Enums: contact shape NONE=0 SPHERE=1; tip section ROUND=0 SQUARE=1 CROSS=2; tip profile
//! TAPERED=0 STRAIGHT=1; roof mode OFF=0 ROOF=1 CAGE=2; preview mode FULL=0 ONLY_TIP=1; bool 0/1.

use super::error::BuildError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContactShape {
    None,
    Sphere,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TipSection {
    Round,
    Square,
    Cross,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TipProfile {
    Tapered,
    Straight,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoofMode {
    Off,
    Roof,
    Cage,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewMode {
    Full,
    OnlyTip,
}

/// The settings one support may own (tip, contact, neck, foot), in `SHAPE_LAYOUT` order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShapeSettings {
    pub contact_shape: ContactShape,
    pub tip_section: TipSection,
    pub tip_cross_width: f64,
    pub tip_profile: TipProfile,
    pub point_diameter: f64,
    pub touch_diameter: f64,
    pub point_depth: f64,
    pub touch_depth: f64,
    pub neck_diameter: f64,
    pub neck_length: f64,
    pub max_neck_angle: f64,
    pub base_diameter: f64,
    pub base_height: f64,
}

/// Names of the flat settings array, in order. The host packer must match (tested).
pub const SETTINGS_LAYOUT: [&str; 66] = [
    "contactShape", "pointDiameter", "pointDepth", "tipSection", "tipCrossWidth", "tipProfile",
    "touchDiameter", "touchDepth", "neckDiameter", "neckLength", "maxNeckAngle",
    "pillarDiameter", "treeSectionIncrement", "baseDiameter", "baseHeight",
    "trussEnabled", "trussDiameter", "trussAngle", "trussSpacing", "trussMinHeight", "trussTopSpacing", "trussDistanceLimit",
    "raftEnabled", "raftExpandWidth", "raftFloorThickness", "raftWallHeight", "raftWallThickness", "raftWallAngle", "voxelResolution",
    "roofMode", "roofGap", "cageSideGap", "cageTopGap", "cagePitch", "cageRingDiameter", "columnCount", "columnDiameter",
    "diagonalEnabled", "diagonalDiameter", "braceConcentric", "braceThickness", "braceAngle", "storeyFloorThickness", "storeyEncloseCeiling",
    "labelEnabled", "labelSize", "labelHeight", "labelMargin", "labelOffsetX", "labelOffsetY",
    "previewMode", "autoSnap", "lowPolyMode", "resolution",
    "scatterSpacing", "scatterAngle", "scatterSafeDistance", "scatterFacingDown", "scatterIslands", "scatterRidgeAngle",
    "scatterAutoTree", "scatterMergeDistance", "scatterBranchDescent", "reinforceOverhangEdges",
    "liftHeight", "eraseRadius",
];

/// Order of a flat per-contact shape override (13 values; NaN = follows the object).
pub const SHAPE_LAYOUT: [&str; 13] = [
    "contactShape", "tipSection", "tipCrossWidth", "tipProfile", "pointDiameter", "touchDiameter", "pointDepth",
    "touchDepth", "neckDiameter", "neckLength", "maxNeckAngle", "baseDiameter", "baseHeight",
];

#[derive(Clone, Debug, PartialEq)]
pub struct SupportSettings {
    pub shape: ShapeSettings,
    pub pillar_diameter: f64,
    pub tree_section_increment: f64,
    pub truss_enabled: bool,
    pub truss_diameter: f64,
    pub truss_angle: f64,
    pub truss_spacing: f64,
    pub truss_min_height: f64,
    pub truss_top_spacing: f64,
    pub truss_distance_limit: f64,
    pub raft_enabled: bool,
    pub raft_expand_width: f64,
    pub raft_floor_thickness: f64,
    pub raft_wall_height: f64,
    pub raft_wall_thickness: f64,
    pub raft_wall_angle: f64,
    pub voxel_resolution: f64,
    pub roof_mode: RoofMode,
    pub roof_gap: f64,
    pub cage_side_gap: f64,
    pub cage_top_gap: f64,
    pub cage_pitch: f64,
    pub cage_ring_diameter: f64,
    pub column_count: f64,
    pub column_diameter: f64,
    pub diagonal_enabled: bool,
    pub diagonal_diameter: f64,
    pub brace_concentric: f64,
    pub brace_thickness: f64,
    pub brace_angle: f64,
    pub storey_floor_thickness: f64,
    pub storey_enclose_ceiling: bool,
    pub label_enabled: bool,
    pub label_size: f64,
    pub label_height: f64,
    pub label_margin: f64,
    pub label_offset_x: f64,
    pub label_offset_y: f64,
    pub preview_mode: PreviewMode,
    pub auto_snap: bool,
    pub low_poly_mode: bool,
    pub resolution: f64,
    pub scatter_spacing: f64,
    pub scatter_angle: f64,
    pub scatter_safe_distance: f64,
    pub scatter_facing_down: bool,
    pub scatter_islands: bool,
    pub scatter_ridge_angle: f64,
    pub scatter_auto_tree: bool,
    pub scatter_merge_distance: f64,
    pub scatter_branch_descent: f64,
    pub reinforce_overhang_edges: bool,
    pub lift_height: f64,
    pub erase_radius: f64,
}

impl SupportSettings {
    /// Radius of the tip end at the model: Upper diameter under a contact sphere, else Point diameter.
    pub fn tip_radius(&self) -> f64 {
        self.shape.tip_radius()
    }
    /// How far the contact end sits inside the model.
    pub fn tip_depth(&self) -> f64 {
        self.shape.tip_depth()
    }
    /// These settings with one support's own shape on top.
    pub fn with_shape(&self, shape: Option<&ShapeSettings>) -> SupportSettings {
        match shape {
            Some(shape) => SupportSettings { shape: *shape, ..self.clone() },
            None => self.clone(),
        }
    }
}

impl ShapeSettings {
    pub fn tip_radius(&self) -> f64 {
        (if self.contact_shape == ContactShape::Sphere { self.neck_diameter } else { self.point_diameter }) / 2.0
    }
    pub fn tip_depth(&self) -> f64 {
        if self.contact_shape == ContactShape::Sphere { self.touch_depth } else { self.point_depth }
    }

    /// Per-contact override over `base`: NaN entries follow the object. Range-checked like settings.
    pub fn overridden(base: &ShapeSettings, values: &[f64]) -> Result<ShapeSettings, BuildError> {
        if values.len() != SHAPE_LAYOUT.len() {
            return Err(BuildError::BadInput("shape override length"));
        }
        let mut reader = Reader { values, next: 0, names: &SHAPE_LAYOUT, shape_mode: true };
        let read = reader.shape()?;
        Ok(read.merged(base))
    }
}

/// A shape read with optional fields (NaN = unset), before merging over a base.
struct PartialShape {
    contact: Option<ContactShape>,
    section: Option<TipSection>,
    profile: Option<TipProfile>,
    numbers: [f64; 10],
}

impl PartialShape {
    fn merged(self, base: &ShapeSettings) -> ShapeSettings {
        let n = |i: usize, keep: f64| if self.numbers[i].is_nan() { keep } else { self.numbers[i] };
        ShapeSettings {
            contact_shape: self.contact.unwrap_or(base.contact_shape),
            tip_section: self.section.unwrap_or(base.tip_section),
            tip_cross_width: n(0, base.tip_cross_width),
            tip_profile: self.profile.unwrap_or(base.tip_profile),
            point_diameter: n(1, base.point_diameter),
            touch_diameter: n(2, base.touch_diameter),
            point_depth: n(3, base.point_depth),
            touch_depth: n(4, base.touch_depth),
            neck_diameter: n(5, base.neck_diameter),
            neck_length: n(6, base.neck_length),
            max_neck_angle: n(7, base.max_neck_angle),
            base_diameter: n(8, base.base_diameter),
            base_height: n(9, base.base_height),
        }
    }
}

struct Reader<'a> {
    values: &'a [f64],
    next: usize,
    names: &'a [&'static str],
    /// Shape-override reader: NaN means "unset" instead of an error.
    shape_mode: bool,
}

impl Reader<'_> {
    fn raw(&mut self, name: &'static str) -> Result<f64, BuildError> {
        debug_assert_eq!(self.names[self.next], name, "settings layout drift");
        let value = self.values[self.next];
        self.next += 1;
        if value.is_nan() && self.shape_mode {
            return Ok(f64::NAN);
        }
        if !value.is_finite() {
            return Err(BuildError::SettingOutOfRange(name));
        }
        Ok(value)
    }
    fn num(&mut self, name: &'static str, min: f64, max: f64, integer: bool) -> Result<f64, BuildError> {
        let value = self.raw(name)?;
        if value.is_nan() {
            return Ok(value);
        }
        if value < min || value > max || (integer && value.fract() != 0.0) {
            return Err(BuildError::SettingOutOfRange(name));
        }
        Ok(value)
    }
    fn length(&mut self, name: &'static str) -> Result<f64, BuildError> {
        self.num(name, 0.0, 1000.0, false)
    }
    fn flag(&mut self, name: &'static str) -> Result<bool, BuildError> {
        match self.raw(name)? {
            v if v == 0.0 => Ok(false),
            v if v == 1.0 => Ok(true),
            _ => Err(BuildError::SettingOutOfRange(name)),
        }
    }
    /// An enum code in 0..count; None when unset (shape override).
    fn choice(&mut self, name: &'static str, count: u8) -> Result<Option<u8>, BuildError> {
        let value = self.raw(name)?;
        if value.is_nan() {
            return Ok(None);
        }
        if value.fract() != 0.0 || value < 0.0 || value >= f64::from(count) {
            return Err(BuildError::SettingOutOfRange(name));
        }
        Ok(Some(value as u8))
    }
    fn required(&mut self, name: &'static str, count: u8) -> Result<u8, BuildError> {
        self.choice(name, count)?.ok_or(BuildError::SettingOutOfRange(name))
    }

    /// The 13 shape fields in `SHAPE_LAYOUT` order.
    fn shape(&mut self) -> Result<PartialShape, BuildError> {
        let contact = self.choice("contactShape", 2)?.map(contact_shape);
        let section = self.choice("tipSection", 3)?.map(tip_section);
        let cross = self.num("tipCrossWidth", 10.0, 90.0, false)?;
        let profile = self.choice("tipProfile", 2)?.map(tip_profile);
        let point_d = self.num("pointDiameter", 0.05, 1000.0, false)?;
        let touch_d = self.length("touchDiameter")?;
        let point_depth = self.num("pointDepth", 0.05, 1000.0, false)?;
        let touch_depth = self.num("touchDepth", -2.0, 1000.0, false)?;
        let neck_d = self.length("neckDiameter")?;
        let neck_l = self.length("neckLength")?;
        let angle = self.num("maxNeckAngle", 0.0, 89.0, false)?;
        let base_d = self.length("baseDiameter")?;
        let base_h = self.length("baseHeight")?;
        Ok(PartialShape {
            contact,
            section,
            profile,
            numbers: [cross, point_d, touch_d, point_depth, touch_depth, neck_d, neck_l, angle, base_d, base_h],
        })
    }
}

fn contact_shape(code: u8) -> ContactShape {
    if code == 0 { ContactShape::None } else { ContactShape::Sphere }
}
fn tip_section(code: u8) -> TipSection {
    [TipSection::Round, TipSection::Square, TipSection::Cross][code as usize]
}
fn tip_profile(code: u8) -> TipProfile {
    if code == 0 { TipProfile::Tapered } else { TipProfile::Straight }
}

impl SupportSettings {
    /// Reads the flat array in `SETTINGS_LAYOUT` order.
    pub fn from_slice(values: &[f64]) -> Result<SupportSettings, BuildError> {
        if values.len() != SETTINGS_LAYOUT.len() {
            return Err(BuildError::BadInput("settings length"));
        }
        let mut r = Reader { values, next: 0, names: &SETTINGS_LAYOUT, shape_mode: false };
        // Layout order differs from SHAPE_LAYOUT (pillar and tree increment sit inside the shape run).
        let contact = contact_shape(r.required("contactShape", 2)?);
        let point_d = r.num("pointDiameter", 0.05, 1000.0, false)?;
        let point_depth = r.num("pointDepth", 0.05, 1000.0, false)?;
        let section = tip_section(r.required("tipSection", 3)?);
        let cross = r.num("tipCrossWidth", 10.0, 90.0, false)?;
        let profile = tip_profile(r.required("tipProfile", 2)?);
        let touch_d = r.length("touchDiameter")?;
        let touch_depth = r.num("touchDepth", -2.0, 1000.0, false)?;
        let neck_d = r.length("neckDiameter")?;
        let neck_l = r.length("neckLength")?;
        let angle = r.num("maxNeckAngle", 0.0, 89.0, false)?;
        let pillar = r.length("pillarDiameter")?;
        let tree_inc = r.num("treeSectionIncrement", 0.0, 100.0, false)?;
        let base_d = r.length("baseDiameter")?;
        let base_h = r.length("baseHeight")?;
        let shape = ShapeSettings {
            contact_shape: contact,
            tip_section: section,
            tip_cross_width: cross,
            tip_profile: profile,
            point_diameter: point_d,
            touch_diameter: touch_d,
            point_depth,
            touch_depth,
            neck_diameter: neck_d,
            neck_length: neck_l,
            max_neck_angle: angle,
            base_diameter: base_d,
            base_height: base_h,
        };
        Ok(SupportSettings {
            shape,
            pillar_diameter: pillar,
            tree_section_increment: tree_inc,
            truss_enabled: r.flag("trussEnabled")?,
            truss_diameter: r.length("trussDiameter")?,
            truss_angle: r.num("trussAngle", 10.0, 60.0, false)?,
            truss_spacing: r.length("trussSpacing")?,
            truss_min_height: r.length("trussMinHeight")?,
            truss_top_spacing: r.length("trussTopSpacing")?,
            truss_distance_limit: r.length("trussDistanceLimit")?,
            raft_enabled: r.flag("raftEnabled")?,
            raft_expand_width: r.length("raftExpandWidth")?,
            raft_floor_thickness: r.length("raftFloorThickness")?,
            raft_wall_height: r.length("raftWallHeight")?,
            raft_wall_thickness: r.length("raftWallThickness")?,
            raft_wall_angle: r.num("raftWallAngle", 0.0, 90.0, false)?,
            voxel_resolution: r.num("voxelResolution", 2.0, 512.0, true)?,
            roof_mode: match r.required("roofMode", 3)? {
                0 => RoofMode::Off,
                1 => RoofMode::Roof,
                _ => RoofMode::Cage,
            },
            roof_gap: r.num("roofGap", 1.0, 100.0, false)?,
            cage_side_gap: r.num("cageSideGap", 1.0, 20.0, false)?,
            cage_top_gap: r.num("cageTopGap", 0.0, 100.0, false)?,
            cage_pitch: r.num("cagePitch", 3.0, 50.0, false)?,
            cage_ring_diameter: r.num("cageRingDiameter", 0.3, 10.0, false)?,
            column_count: r.num("columnCount", 3.0, 64.0, true)?,
            column_diameter: r.num("columnDiameter", 0.5, 20.0, false)?,
            diagonal_enabled: r.flag("diagonalEnabled")?,
            diagonal_diameter: r.num("diagonalDiameter", 0.3, 10.0, false)?,
            brace_concentric: r.num("braceConcentric", 0.0, 32.0, true)?,
            brace_thickness: r.num("braceThickness", 0.3, 10.0, false)?,
            brace_angle: r.num("braceAngle", 0.0, 90.0, false)?,
            storey_floor_thickness: r.num("storeyFloorThickness", 0.5, 20.0, false)?,
            storey_enclose_ceiling: r.flag("storeyEncloseCeiling")?,
            label_enabled: r.flag("labelEnabled")?,
            label_size: r.num("labelSize", 1.0, 50.0, false)?,
            label_height: r.num("labelHeight", 0.1, 5.0, false)?,
            label_margin: r.num("labelMargin", 0.0, 20.0, false)?,
            label_offset_x: r.num("labelOffsetX", -200.0, 200.0, false)?,
            label_offset_y: r.num("labelOffsetY", -200.0, 200.0, false)?,
            preview_mode: if r.required("previewMode", 2)? == 0 { PreviewMode::Full } else { PreviewMode::OnlyTip },
            auto_snap: r.flag("autoSnap")?,
            low_poly_mode: r.flag("lowPolyMode")?,
            resolution: r.num("resolution", 3.0, 64.0, true)?,
            scatter_spacing: r.num("scatterSpacing", 0.2, 100.0, false)?,
            scatter_angle: r.num("scatterAngle", 0.0, 90.0, false)?,
            scatter_safe_distance: r.length("scatterSafeDistance")?,
            scatter_facing_down: r.flag("scatterFacingDown")?,
            scatter_islands: r.flag("scatterIslands")?,
            scatter_ridge_angle: r.num("scatterRidgeAngle", 0.0, 180.0, false)?,
            scatter_auto_tree: r.flag("scatterAutoTree")?,
            scatter_merge_distance: r.length("scatterMergeDistance")?,
            scatter_branch_descent: r.num("scatterBranchDescent", -1000.0, 1000.0, false)?,
            reinforce_overhang_edges: r.flag("reinforceOverhangEdges")?,
            lift_height: r.num("liftHeight", 0.0, 200.0, false)?,
            erase_radius: r.num("eraseRadius", 0.1, 50.0, false)?,
        })
    }
}

#[cfg(test)]
pub(crate) fn default_values() -> Vec<f64> {
    // defaultSupportSettings (LIGHT preset) in SETTINGS_LAYOUT order.
    vec![
        0.0, 0.2, 0.2, 0.0, 40.0, 0.0, 0.5, 0.0, 0.3, 2.0, 45.0, 0.8, 20.0, 3.0, 1.2,
        1.0, 0.8, 45.0, 2.0, 3.0, 0.0, 100.0,
        1.0, 3.0, 1.0, 1.5, 0.5, 30.0, 16.0,
        0.0, 5.0, 4.0, 5.0, 10.0, 1.0, 6.0, 1.5, 0.0, 1.0, 3.0, 1.0, 40.0, 1.5, 1.0,
        1.0, 5.0, 0.6, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 12.0,
        2.0, 50.0, 0.0, 1.0, 1.0, 45.0, 0.0, 2.0, 2.0, 1.0,
        5.0, 1.5,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
