//! Mode C: the reference aligner, mirrored, scaled or noised (SPEC.md "Mode C").

use crate::geom::{Label, Solid, V3, add, read_stl, reader_to_file, scale, sub, to_solid, undo_reader_rotation, vertex_normals};
use crate::rng::SplitMix64;
use mixo_geometry_core::dental::mesh::Mesh;
use mixo_geometry_core::dental::orient::{Proposal, propose_orientation};
use mixo_geometry_core::dental::profiles::reference_aligner;

pub struct Reference {
    /// In the file's own frame (the reader's rotation undone).
    pub solid: Solid,
    pub chi: i64,
    /// The accepted opening direction, in the file frame.
    pub opening: V3,
}

pub fn load(path: &str) -> Result<Reference, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("reference {path}: {e}"))?;
    let (mut positions, indices) = read_stl(&bytes)?;
    let opening = match propose_orientation(&Mesh::new(&positions, &indices), reference_aligner()) {
        Proposal::Proposal { rim, .. } => reader_to_file(rim.opening_direction),
        Proposal::Inconclusive { reason, .. } => return Err(format!("reference orientation is inconclusive: {}", reason.code())),
    };
    undo_reader_rotation(&mut positions);
    let solid = to_solid(&positions, &indices, Label::Shell);
    let chi = crate::checks::euler(solid.positions.len(), &solid.triangles);
    Ok(Reference { solid, chi, opening })
}

/// Operations in order: mirror, scale, noise. Returns the solid and the mapped opening direction.
pub fn perturb(source: &Solid, opening: V3, mirror: bool, factor: Option<f64>, noise: f64, rng: &mut SplitMix64) -> (Solid, V3) {
    let mut solid = source.clone();
    let mut opening = opening;
    if mirror {
        for p in &mut solid.positions {
            p[0] = -p[0];
        }
        for t in &mut solid.triangles {
            t.swap(1, 2);
        }
        opening[0] = -opening[0];
    }
    if let Some(factor) = factor {
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for p in &solid.positions {
            for a in 0..3 {
                lo[a] = lo[a].min(p[a]);
                hi[a] = hi[a].max(p[a]);
            }
        }
        let centre = scale(add(lo, hi), 0.5);
        for p in &mut solid.positions {
            *p = add(centre, scale(sub(*p, centre), factor));
        }
    }
    if noise > 0.0 {
        let normals = vertex_normals(&solid.positions, &solid.triangles);
        for (p, n) in solid.positions.iter_mut().zip(&normals) {
            *p = add(*p, scale(*n, noise * rng.symmetric()));
        }
    }
    (solid, opening)
}
