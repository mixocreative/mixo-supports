//! Step 1 of the dental flow: what detection learns about a dropped aligner (`orient_dental`).
//! Orientation never silently continues: an uncertain pose is reported as `None`, and a central
//! opening that cannot be decided is `Ambiguous`, never `Absent`.

use super::mesh::Mesh;
use super::opening::{Opening, central_opening};
use super::orient::{Diagnostics, Proposal, Reason, propose_orientation};
use super::pose::rotation_to_dental_pose;
use super::profiles::AlignerProfile;
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
    let rotation = rotation_to_dental_pose(mesh, &rim);
    Orientation::Oriented { rim: Box::new(rim), diagnostics, rotation, opening, mesh_ok, opening_reason }
}
