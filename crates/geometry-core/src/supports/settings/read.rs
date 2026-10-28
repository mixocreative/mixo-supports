//! Reading the flat settings arrays (`SETTINGS_LAYOUT`, `SHAPE_LAYOUT`) into `SupportSettings` and
//! `ShapeSettings`: every value range-checked, a typed error instead of a clamp.

use super::{ContactShape, PreviewMode, RoofMode, SETTINGS_LAYOUT, SHAPE_LAYOUT, ShapeSettings, SupportSettings, TipProfile, TipSection};
use crate::supports::error::BuildError;

impl ShapeSettings {
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
            plate_y: 0.0,
        })
    }
}
