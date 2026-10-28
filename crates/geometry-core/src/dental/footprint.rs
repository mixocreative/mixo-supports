//! Operator tuning (area position, width, density) and the narrow contact footprint it produces:
//! the support area along each contour plus the contacts sampled on its middle line.

use super::cache;
use super::field::{ContourField, Reach, prepare};
use super::mesh::Mesh;
use super::profiles::AlignerProfile;
use super::sampling::{ContourContact, FromBelow, SampleSettings, Sampled, TipLine, Walk, sample_with};
use crate::core::vec::V3;

/// Bounded operator controls (UI limits, not validated clinical ranges). `position_mm` is the signed
/// surface distance of the area's middle line from the detected edge: positive onto the outer
/// (non-fitting) side, negative across the edge. `strip_width_mm` is the area's width.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tuning {
    pub position_mm: f64,
    pub strip_width_mm: f64,
    pub density: f64,
}

impl Tuning {
    pub fn defaults(profile: &AlignerProfile) -> Self {
        let d = &profile.defaults;
        Self { position_mm: d.position_mm, strip_width_mm: d.strip_width_mm, density: d.density }
    }

    /// The tuning of an older project saved as a setback (area `[setback, setback + width]`): the
    /// same area, described by its middle line.
    pub fn from_setback(setback_mm: f64, strip_width_mm: f64, density: f64) -> Self {
        Self { position_mm: setback_mm + strip_width_mm / 2.0, strip_width_mm, density }
    }

    /// `Err` when a value is non-finite or outside the profile's limits.
    pub fn validate(&self, profile: &AlignerProfile) -> Result<Self, &'static str> {
        let d = &profile.defaults;
        let finite = [self.position_mm, self.strip_width_mm, self.density].iter().all(|v| v.is_finite());
        if !finite
            || self.position_mm < d.position_min_mm
            || self.position_mm > d.position_max_mm
            || self.strip_width_mm < d.strip_width_min_mm
            || self.strip_width_mm > d.strip_width_max_mm
            || self.density < d.density_min
            || self.density > d.density_max
        {
            return Err("invalid-tuning");
        }
        Ok(*self)
    }

    /// The area as signed contour distances `[low, high]`: the width centred on the position, but
    /// never farther across the edge than the position itself (widening never spills onto the
    /// fitting side; only moving the position across the edge does).
    pub fn band(&self) -> (f64, f64) {
        let half = self.strip_width_mm / 2.0;
        ((self.position_mm - half).max(self.position_mm.min(0.0)), self.position_mm + half)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FootprintSettings {
    /// The area: faces whose signed contour distance lies in `[low, high]` (mm).
    pub low: f64,
    pub high: f64,
    pub outer_spacing: f64,
    pub inner_spacing: f64,
    pub max_search_distance: f64,
    /// Where the samples sit within each even step, as a fraction of it (`None`: 0, the primaries;
    /// 0.5 puts them halfway between, the repair alternates).
    pub sample_phase_fraction: Option<f64>,
    /// No two contacts (either contour) closer than this, 3D mm; 0 = off.
    pub min_tip_separation: f64,
    /// How far the distance field is walked (outer side, across the edge): the profile's widest
    /// area, so every tuning of one profile shares one field.
    pub reach: Reach,
    /// Tips a support must reach from below (`None`: no print pose known, tips stay on the line).
    pub from_below: Option<Facing>,
}

/// The print pose's plate normal in the mesh frame and the profile's reach rule
/// (`tipMinFromUpDeg`, `tipMoveMaxMm`); see `sampling::FromBelow`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Facing {
    pub up: V3,
    /// Largest `dot(normal, up)` a tip face may have.
    pub max_up: f64,
    /// How far past the area (surface mm, either side of the edge) a tip may move.
    pub move_mm: f64,
}

impl Facing {
    /// The rule of `profile` for plate normal `up` (mesh frame, any length; `None` if zero).
    pub fn of(up: V3, profile: &AlignerProfile) -> Option<Self> {
        let length = crate::core::jsnum::hypot3(up);
        let d = &profile.defaults;
        (length.is_finite() && length > 1e-12).then(|| Self { up: up.map(|v| v / length), max_up: d.tip_min_from_up_deg.to_radians().cos(), move_mm: d.tip_move_max_mm })
    }
}

impl FootprintSettings {
    /// The middle line the tips are placed on.
    pub fn tip_line(&self) -> f64 {
        (self.low + self.high) / 2.0
    }
}

pub fn footprint_settings(tuning: &Tuning, profile: &AlignerProfile) -> Result<FootprintSettings, &'static str> {
    let tuning = tuning.validate(profile)?;
    let d = &profile.defaults;
    let (low, high) = tuning.band();
    Ok(FootprintSettings {
        low,
        high,
        outer_spacing: d.outer_spacing_mm / tuning.density,
        inner_spacing: d.inner_spacing_mm / tuning.density,
        max_search_distance: d.max_search_mm,
        sample_phase_fraction: None,
        min_tip_separation: d.min_tip_separation_mm,
        // Across the edge the field also covers how far a tip may move to be reached from below.
        reach: [(d.position_max_mm + d.strip_width_max_mm / 2.0).max(high), (-d.position_min_mm).max(-low).max(0.0) + d.tip_move_max_mm],
        from_below: None,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RimSide {
    Outer,
    Opening,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Contact {
    pub rim: RimSide,
    pub contact: ContourContact,
}

pub struct Footprint {
    pub contact_faces: Vec<u8>,
    pub outer_contacts: Vec<ContourContact>,
    pub inner_contacts: Vec<ContourContact>,
}

/// The area along both contours and the contacts sampled on its middle line. `Err` is the oracle's
/// reason string. The distance field is kept across calls (`cache::prepared`), so a retune only
/// thresholds it and samples. Not a production permission: the engine checks every contact.
pub fn propose_footprint(mesh: &Mesh, allowed_faces: &[u8], outer: &[u32], opening: &[u32], settings: &FootprintSettings) -> Result<Footprint, &'static str> {
    let (low, high) = (settings.low, settings.high);
    if !low.is_finite() || !high.is_finite() || high <= low || allowed_faces.len() != mesh.face_count() {
        return Err("invalid-band-input");
    }
    let key = cache::PreparedKey::of(mesh, allowed_faces, outer, opening, settings.reach);
    let prepared = cache::prepared(key, || prepare(mesh, allowed_faces, outer, opening, settings.reach));
    let prepared = prepared.as_ref().as_ref().map_err(|reason| *reason)?;
    let sample = |contour: &[u32], field: &ContourField, band: &[u8], spacing: f64, keep_clear_of: &[ContourContact]| -> Result<Sampled, &'static str> {
        let reachable = settings.from_below.map(|f| field.band(low - f.move_mm, high + f.move_mm));
        let settings = SampleSettings {
            spacing,
            max_search: settings.max_search_distance,
            phase: settings.sample_phase_fraction,
            up: settings.from_below.map(|f| f.up),
            min_separation: settings.min_tip_separation,
            keep_clear_of,
            tip_line: Some(TipLine { at: settings.tip_line(), signed: &field.signed, either_side: low < 0.0 && high > 0.0 }),
            from_below: settings.from_below.zip(reachable.as_deref()).map(|(f, reachable)| FromBelow { up: f.up, max_up: f.max_up, reachable }),
        };
        sample_with(mesh, contour, &field.pairs, &Walk { graph: &prepared.graph, blocked: &field.blocked }, band, &settings)
    };
    let (outer_band, inner_band) = (prepared.outer.band(low, high), prepared.opening.band(low, high));
    let outer_samples = sample(outer, &prepared.outer, &outer_band, settings.outer_spacing, &[])?;
    let inner_samples = sample(opening, &prepared.opening, &inner_band, settings.inner_spacing, &outer_samples.contacts)?;
    let contact_faces = outer_band.iter().zip(&inner_band).map(|(a, b)| a | b).collect();
    Ok(Footprint { contact_faces, outer_contacts: outer_samples.contacts, inner_contacts: inner_samples.contacts })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dental::profiles::reference_aligner;

    #[test]
    fn the_area_is_centred_on_the_position_and_density_scales_both_spacings() {
        let profile = reference_aligner();
        let s = footprint_settings(&Tuning::defaults(profile), profile).unwrap();
        assert_eq!((s.low, s.high, s.outer_spacing, s.inner_spacing, s.max_search_distance), (0.0, 0.5, 3.0, 4.0, 1.5));
        assert_eq!((s.min_tip_separation, s.tip_line()), (0.6, 0.25));
        assert_eq!((s.reach, s.from_below), ([3.7, 1.4], None));
        let s = footprint_settings(&Tuning { position_mm: 0.7, strip_width_mm: 0.4, density: 1.5 }, profile).unwrap();
        assert!((s.low - 0.5).abs() < 1e-12 && (s.high - 0.9).abs() < 1e-12);
        assert_eq!((s.outer_spacing, s.inner_spacing), (2.0, 4.0 / 1.5));
        assert!(footprint_settings(&Tuning { position_mm: 0.2, strip_width_mm: 2.5, density: 1.0 }, profile).is_err());
        assert!(footprint_settings(&Tuning { position_mm: -0.5, strip_width_mm: 1.0, density: 1.0 }, profile).is_err());
    }

    #[test]
    fn widening_never_crosses_the_edge_but_moving_the_position_across_does() {
        let wide = Tuning { position_mm: 0.3, strip_width_mm: 2.4, density: 1.0 };
        assert_eq!(wide.band(), (0.0, 1.5));
        let across = Tuning { position_mm: -0.3, strip_width_mm: 1.0, density: 1.0 };
        assert_eq!(across.band(), (-0.3, 0.2));
        let old = Tuning::from_setback(0.2, 1.0, 1.0);
        assert!((old.band().0 - 0.2).abs() < 1e-12 && (old.band().1 - 1.2).abs() < 1e-12);
    }
}
