//! Step 1 of the dental flow: what detection learns about a dropped aligner (`orient_dental`).
//! Orientation never silently continues: an uncertain pose is reported as `None`, and a central
//! opening that cannot be decided is `Ambiguous`, never `Absent`.

use super::mesh::Mesh;
use super::opening::{Opening, central_opening};
use super::orient::{Diagnostics, Proposal, Reason, propose_orientation};
use super::pose::rotation_to_dental_pose;
use super::profiles::{AlignerProfile, OpeningExpected};
use super::rim::Rim;
use super::topology::Context;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpeningState {
    Present,
    Absent,
    Ambiguous,
}

#[derive(Clone, Debug)]
pub enum Orientation {
    Oriented {
        rim: Box<Rim>,
        diagnostics: Diagnostics,
        /// Euler XYZ restoring the reference pose; `None` when the arch front is ambiguous.
        rotation: Option<[f64; 3]>,
        opening: OpeningState,
        /// False for an open, non-manifold or degenerate mesh (opening was not decidable).
        mesh_ok: bool,
        /// Why the opening is ambiguous, when it is.
        opening_reason: Option<&'static str>,
    },
    Failed { reason: Reason, mesh_ok: bool },
}

/// Whether what Step 1 found fits the chosen aligner type: a type that expects a central opening
/// does not match an aligner whose opening is absent, and one that expects none does not match a
/// present opening. An ambiguous opening never decides a mismatch.
pub fn matches_profile(opening: OpeningState, profile: &AlignerProfile) -> bool {
    !matches!((profile.opening, opening), (OpeningExpected::Yes, OpeningState::Absent) | (OpeningExpected::No, OpeningState::Present))
}

pub fn orient_dental(mesh: &Mesh, profile: &AlignerProfile) -> Orientation {
    let (rim, diagnostics) = match propose_orientation(mesh, profile) {
        Proposal::Proposal { rim, diagnostics } => (rim, diagnostics),
        Proposal::Inconclusive { reason, .. } => return Orientation::Failed { reason, mesh_ok: reason != Reason::InvalidMesh },
    };
    let (opening, mesh_ok, opening_reason) = match Context::build(mesh, &rim) {
        None => (OpeningState::Ambiguous, false, Some("invalid-mesh")),
        Some(context) => match central_opening(&context, profile) {
            Opening::Present(_) => (OpeningState::Present, true, None),
            Opening::Absent => (OpeningState::Absent, true, None),
            Opening::Ambiguous(reason) => (OpeningState::Ambiguous, true, Some(reason)),
        },
    };
    let rotation = rotation_to_dental_pose(mesh, &rim, profile);
    Orientation::Oriented { rim: Box::new(rim), diagnostics, rotation, opening, mesh_ok, opening_reason }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dental::profiles::reference_aligner;

    #[test]
    fn the_profile_decides_which_opening_is_a_mismatch() {
        let mut profile = reference_aligner().clone();
        assert!(!matches_profile(OpeningState::Absent, &profile));
        assert!(matches_profile(OpeningState::Present, &profile) && matches_profile(OpeningState::Ambiguous, &profile));
        profile.opening = OpeningExpected::No;
        assert!(!matches_profile(OpeningState::Present, &profile) && matches_profile(OpeningState::Absent, &profile));
        profile.opening = OpeningExpected::Either;
        assert!(matches_profile(OpeningState::Present, &profile) && matches_profile(OpeningState::Absent, &profile));
    }
}
