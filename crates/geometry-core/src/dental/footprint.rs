//! Operator tuning (setback, strip width, density) and the narrow contact footprint it produces:
//! the non-fitting side strip along each contour plus the sampled contacts on it.

use super::bands::diagnostic_side_bands;
use super::mesh::Mesh;
use super::profiles::AlignerProfile;
use super::sampling::{ContourContact, SampleSettings, sample_contour_contacts};

/// Bounded operator controls (UI limits, not validated clinical ranges).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tuning {
    pub setback_mm: f64,
    pub strip_width_mm: f64,
    pub density: f64,
}

impl Tuning {
    pub fn defaults(profile: &AlignerProfile) -> Self {
        let d = &profile.defaults;
        Self { setback_mm: d.setback_mm, strip_width_mm: d.strip_width_mm, density: d.density }
    }

    /// `Err` when a value is non-finite or outside the profile's limits.
    pub fn validate(&self, profile: &AlignerProfile) -> Result<Self, &'static str> {
        let d = &profile.defaults;
        let finite = [self.setback_mm, self.strip_width_mm, self.density].iter().all(|v| v.is_finite());
        if !finite
            || self.setback_mm < 0.0
            || self.setback_mm > d.setback_max_mm
            || self.strip_width_mm < d.strip_width_min_mm
            || self.strip_width_mm > d.strip_width_max_mm
            || self.density < d.density_min
            || self.density > d.density_max
        {
            return Err("invalid-tuning");
        }
        Ok(*self)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FootprintSettings {
    pub setback: f64,
    pub width: f64,
    pub outer_spacing: f64,
    pub inner_spacing: f64,
    pub max_search_distance: f64,
    /// 0 samples at the contour origin; `None` keeps the usual half-spacing phase.
    pub sample_phase_fraction: Option<f64>,
    /// No two contacts (either contour) closer than this, 3D mm; 0 = off.
    pub min_tip_separation: f64,
}

pub fn footprint_settings(tuning: &Tuning, profile: &AlignerProfile) -> Result<FootprintSettings, &'static str> {
    let tuning = tuning.validate(profile)?;
    let d = &profile.defaults;
    Ok(FootprintSettings {
        setback: tuning.setback_mm,
        width: tuning.setback_mm + tuning.strip_width_mm,
        outer_spacing: d.outer_spacing_mm / tuning.density,
        inner_spacing: d.inner_spacing_mm / tuning.density,
        max_search_distance: d.max_search_mm,
        sample_phase_fraction: None,
        min_tip_separation: d.min_tip_separation_mm,
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

/// Composes the contour side bands and the contact samplers. `Err` is the oracle's reason string.
/// This is not a production permission: approach, secondary landings and body paths are U7's.
pub fn propose_footprint(mesh: &Mesh, allowed_faces: &[u8], outer: &[u32], opening: &[u32], settings: &FootprintSettings) -> Result<Footprint, &'static str> {
    let bands = diagnostic_side_bands(mesh, allowed_faces, outer, opening, settings.setback, settings.width)?;
    let phase = |spacing: f64| settings.sample_phase_fraction.map(|f| spacing * f);
    let sample = |spacing: f64, keep_clear_of| SampleSettings { spacing, max_search: settings.max_search_distance, phase_mm: phase(spacing), min_separation: settings.min_tip_separation, keep_clear_of };
    let outer_samples = sample_contour_contacts(mesh, outer, &bands.outer_other_side, &sample(settings.outer_spacing, &[]))?;
    let inner_samples = sample_contour_contacts(mesh, opening, &bands.inner_other_side, &sample(settings.inner_spacing, &outer_samples.contacts))?;
    let contact_faces = bands.outer_other_side.iter().zip(&bands.inner_other_side).map(|(a, b)| a | b).collect();
    Ok(Footprint { contact_faces, outer_contacts: outer_samples.contacts, inner_contacts: inner_samples.contacts })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dental::profiles::reference_aligner;

    #[test]
    fn the_strip_starts_after_the_setback_and_density_scales_both_spacings() {
        let profile = reference_aligner();
        let s = footprint_settings(&Tuning::defaults(profile), profile).unwrap();
        assert_eq!((s.setback, s.width, s.outer_spacing, s.inner_spacing, s.max_search_distance), (0.2, 1.2, 3.0, 2.0, 1.5));
        assert_eq!(s.min_tip_separation, 0.6);
        let s = footprint_settings(&Tuning { setback_mm: 0.5, strip_width_mm: 0.4, density: 1.5 }, profile).unwrap();
        assert_eq!((s.setback, s.width, s.outer_spacing, s.inner_spacing), (0.5, 0.9, 2.0, 2.0 / 1.5));
        assert!(footprint_settings(&Tuning { setback_mm: 0.2, strip_width_mm: 2.5, density: 1.0 }, profile).is_err());
    }
}
