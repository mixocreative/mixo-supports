//! Automatic contacts as SLASG_VertexScatter_Mixo builds them, in its stream order and without
//! cross-class de-duplication (port of TS `generatePlacement`):
//! 1. Poisson points on overhang faces (Distribute Points on Faces, POISSON: Distance Min = Spacing,
//!    Density Max = (1/Spacing)^4, seed 0);
//! 2. island minima (local-minimum vertices, merged within Spacing), which get vertical necks,
//!    joined before the merge by the legacy SDF ridge points while Reinforce overhang edges is off;
//! 3. Resin UV edge anchors (exact port of `rebuild_edge_candidates`, creases sharper than Ridge
//!    angle) while it is on.
//! Blender samples the Poisson field and minima on an OpenVDB remesh of the model; the first two
//! streams run on the voxel remesh at Spacing / 4 (`supports::remesh`) and are snapped onto the model.

mod anchors;

mod merge;
mod minima;
mod poisson;
mod random;
mod ridges;

use crate::supports::overhang::{classify_downward_faces, face_overhang_limit, partition_regions};
pub use crate::supports::contact_id::{position_from_id, position_id};

use crate::supports::remesh::{Remesh, SignedDistance};

use crate::core::vec::V3;

use crate::core::jsnum::js_round;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Interior,
    PhysicalBoundary,
    SharpRidge,
    Island,
}

/// A contact before its ID: where it stands, the surface normal there and which stream made it.
#[derive(Clone, Copy, Debug)]
pub struct Candidate {
    pub position: V3,
    pub normal: V3,
    pub source: Source,
}

#[derive(Clone, Debug)]
pub struct PlacedPoint {
    pub id: String,
    pub position: V3,
    pub normal: V3,
    pub source: Source,
}

#[derive(Clone, Copy, Debug)]
pub struct PlacementSettings {
    pub overhang_angle_degrees: f64,
    pub spacing: f64,
    pub edge_inset: f64,
    pub sharp_edge_angle_degrees: f64,
    pub include_islands: bool,
    /// Blender "Downward Faces".
    pub include_downward: bool,
    /// Blender "Reinforce Overhang Edges".
    pub reinforce_edges: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PlacementError {
    /// A setting is out of range (name).
    Range(&'static str),
}

pub struct Placement {
    pub points: Vec<PlacedPoint>,
    /// Faces of each connected downward region, ascending.
    pub regions: Vec<Vec<u32>>,
}

fn validate(s: &PlacementSettings) -> Result<(), PlacementError> {
    if !s.spacing.is_finite() || s.spacing <= 0.0 {
        return Err(PlacementError::Range("spacing"));
    }
    if !s.edge_inset.is_finite() || s.edge_inset < 0.0 {
        return Err(PlacementError::Range("edgeInset"));
    }
    if !s.sharp_edge_angle_degrees.is_finite() || !(0.0..=180.0).contains(&s.sharp_edge_angle_degrees) {
        return Err(PlacementError::Range("sharpEdgeAngleDegrees"));
    }
    if !s.overhang_angle_degrees.is_finite() || !(0.0..=90.0).contains(&s.overhang_angle_degrees) {
        return Err(PlacementError::Range("overhangAngleDegrees"));
    }
    Ok(())
}

/// Every edge (vertices welded by position) is shared by exactly two faces.
fn is_closed(positions: &[f32], indices: &[u32]) -> bool {
    let mut ids: HashMap<[i64; 3], u32> = HashMap::new();
    let mut weld = |index: u32| -> u32 {
        let o = index as usize * 3;
        let key = [0, 1, 2].map(|a| js_round(f64::from(positions[o + a]) * 1e5) as i64);
        let next = ids.len() as u32;
        *ids.entry(key).or_insert(next)
    };
    let mut edges: HashMap<(u32, u32), u32> = HashMap::new();
    for face in indices.chunks_exact(3) {
        let v = [weld(face[0]), weld(face[1]), weld(face[2])];
        for k in 0..3 {
            let (a, b) = (v[k], v[(k + 1) % 3]);
            if a == b {
                continue;
            }
            *edges.entry(if a < b { (a, b) } else { (b, a) }).or_insert(0) += 1;
        }
    }
    !edges.is_empty() && edges.values().all(|&count| count == 2)
}

/// The model in the remesh's shape (vertices, faces, face normals).
fn exact_as_remesh(positions: &[f32], indices: &[u32]) -> (Vec<V3>, Vec<Vec<u32>>, Vec<Option<V3>>) {
    let vertices: Vec<V3> = positions.chunks_exact(3).map(|p| [f64::from(p[0]), f64::from(p[1]), f64::from(p[2])]).collect();
    let faces: Vec<Vec<u32>> = indices.chunks_exact(3).map(|f| f.to_vec()).collect();
    let normals = faces
        .iter()
        .map(|f| {
            let (a, b, c) = (vertices[f[0] as usize], vertices[f[1] as usize], vertices[f[2] as usize]);
            let (ab, ac) = ([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
            let crossed = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
            let size = crate::core::jsnum::hypot3(crossed);
            (size != 0.0).then(|| [crossed[0] / size, crossed[1] / size, crossed[2] / size])
        })
        .collect();
    (vertices, faces, normals)
}

/// Automatic contacts of the model (already turned into the frame the contacts are wanted in).
pub fn generate_placement(positions: &[f32], indices: &[u32], settings: &PlacementSettings) -> Result<Placement, PlacementError> {
    validate(settings)?;
    let limit = face_overhang_limit(settings.overhang_angle_degrees);
    let downward = classify_downward_faces(positions, indices, limit);
    let regions = partition_regions(indices, &downward);

    let mut candidates: Vec<Candidate> = Vec::new();
    // The Poisson field and the minima come from R, the model remeshed at Spacing / 4; like
    // MIXO_ManualPoints, their points are then snapped onto the model's surface. A signed distance
    // needs a closed surface; for open or broken meshes the same rules run on the model itself.
    let needs_remesh = settings.include_downward || settings.include_islands;
    if needs_remesh {
        let (vertices, faces, normals) = if is_closed(positions, indices) {
            let mut remesh = Remesh::new(positions, indices, 0.0, Some(settings.spacing / 4.0), 0.1);
            let full = remesh.full_mesh();
            (full.vertices, full.faces, full.normals)
        } else {
            exact_as_remesh(positions, indices)
        };
        let surface = SignedDistance::new(positions, indices);
        let snap = |c: Candidate| Candidate { position: surface.nearest_point(c.position), ..c };
        if settings.include_downward {
            candidates.extend(poisson::poisson_on_remesh(&vertices, &faces, &normals, settings).into_iter().map(snap));
        }
        if settings.include_islands {
            let stages = minima::minima_stages(&vertices, &faces, settings);
            let to_web = |p: [f32; 3]| -> V3 { [f64::from(p[0]), f64::from(p[2]), -f64::from(p[1])] };
            for (k, point) in stages.kept.iter().enumerate() {
                let position = to_web(*point);
                // Vertical contacts point straight down; edge contacts carry their surface normal, which a
                // Low Poly preview (no remesh to sample) uses for the tip as the export samples it from R.
                let candidate = if stages.kept_vertical[k] {
                    Candidate { position, normal: [0.0, -1.0, 0.0], source: Source::Island }
                } else {
                    Candidate { position, normal: to_web(stages.kept_normals[k]), source: Source::SharpRidge }
                };
                candidates.push(snap(candidate));
            }
        }
    }
    if settings.reinforce_edges {
        let anchor_settings = anchors::AnchorSettings {
            overhang_angle_degrees: limit,
            spacing: settings.spacing,
            radius: settings.edge_inset,
            facing_down: settings.include_downward,
            ridge_angle_degrees: settings.sharp_edge_angle_degrees,
        };
        for anchor in anchors::edge_anchors(positions, indices, &anchor_settings) {
            candidates.push(Candidate { position: anchor.position, normal: anchor.normal, source: anchor.source });
        }
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut points = Vec::new();
    for candidate in candidates {
        let id = position_id(candidate.position);
        if seen.insert(id.clone()) {
            points.push(PlacedPoint { id, position: candidate.position, normal: candidate.normal, source: candidate.source });
        }
    }
    Ok(Placement { points, regions })
}
