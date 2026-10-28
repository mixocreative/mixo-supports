//! Support settings as plain numbers, mirroring the validated TypeScript `LiveSupportSettings`
//! (src/core/supports/settings.ts). The host validates and sends one flat f64 array in
//! `SETTINGS_LAYOUT` order; Rust re-checks every limit and returns a typed error, never clamps.
//! Enums: contact shape NONE=0 SPHERE=1; tip section ROUND=0 SQUARE=1 CROSS=2; tip profile
//! TAPERED=0 STRAIGHT=1; roof mode OFF=0 ROOF=1 CAGE=2; preview mode FULL=0 ONLY_TIP=1; bool 0/1.

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
}

mod read;

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
mod tests;
