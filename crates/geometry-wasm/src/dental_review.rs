//! `diagnose`: the review layers (contact strip, contours, diagnostic strips, sampled contacts, the
//! support mesh) as coloured meshes for the review GLB. Review only; nothing here is permission.

use super::dental::{error, profile_of};
use super::GeometrySession;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

/// The review GLB data of `diagnose`: coloured layers, one per role (docs/SHIP-PLAN.md ABI).
#[wasm_bindgen]
pub struct Diagnosis {
    revision: u32,
    layers: Vec<mixo_geometry_core::dental::review::Layer>,
}

#[wasm_bindgen]
impl Diagnosis {
    /// The request revision, echoed.
    pub fn revision(&self) -> u32 {
        self.revision
    }
    pub fn layer_count(&self) -> u32 {
        self.layers.len() as u32
    }
    pub fn layer_name(&self, layer: u32) -> String {
        self.layers.get(layer as usize).map(|l| l.name.to_string()).unwrap_or_default()
    }
    /// 0xRRGGBB.
    pub fn layer_color(&self, layer: u32) -> u32 {
        self.layers.get(layer as usize).map_or(0, |l| l.color)
    }
    pub fn take_layer_positions(&mut self, layer: u32) -> Vec<f32> {
        self.layers.get_mut(layer as usize).map(|l| std::mem::take(&mut l.positions)).unwrap_or_default()
    }
    /// Empty: the positions are a triangle soup.
    pub fn take_layer_indices(&mut self, layer: u32) -> Vec<u32> {
        self.layers.get_mut(layer as usize).map(|l| std::mem::take(&mut l.indices)).unwrap_or_default()
    }
}

#[wasm_bindgen]
impl GeometrySession {
    /// Review layers of a loaded aligner: the contact strip, the contours and, when given, the
    /// diagnostic strips (`bands`: four masks of one byte per face, or empty), the sampled
    /// contacts (position then normal, 6 numbers each), and a support mesh with a tip flag per
    /// triangle. Review only; nothing here is support permission.
    pub fn diagnose(
        &self,
        model: u32,
        revision: u32,
        profile: &str,
        contact_faces: &[u8],
        outer_ridge_edges: &[u32],
        connector_edges: &[u32],
        opening_edges: &[u32],
        bands: &[u8],
        outer_contacts: &[f64],
        inner_contacts: &[f64],
        support_positions: &[f32],
        support_indices: &[u32],
        tip_flags: &[u8],
    ) -> Result<Diagnosis, JsValue> {
        use mixo_geometry_core::dental::review::{ReviewError, ReviewInput, SupportMesh, review_layers};
        profile_of(profile)?;
        let mesh = self.mesh(model)?;
        let faces = mesh.face_count();
        if (!bands.is_empty() && bands.len() != faces * 4) || outer_contacts.len() % 6 != 0 || inner_contacts.len() % 6 != 0 {
            return Err(error("INVALID_LENGTH"));
        }
        let band_views = (!bands.is_empty()).then(|| [&bands[..faces], &bands[faces..faces * 2], &bands[faces * 2..faces * 3], &bands[faces * 3..]]);
        let support = (!support_indices.is_empty()).then_some(SupportMesh { positions: support_positions, indices: support_indices, tip_flags });
        if support.is_some() && (support_indices.len() % 3 != 0 || support_indices.iter().any(|&i| i as usize * 3 + 2 >= support_positions.len())) {
            return Err(error("INVALID_INDEX"));
        }
        let input = ReviewInput {
            mesh, contact_faces, outer_ridge: outer_ridge_edges, connectors: connector_edges, opening: opening_edges,
            bands: band_views, outer_contacts, inner_contacts, support,
        };
        let layers = review_layers(&input).map_err(|e| match e {
            ReviewError::ContactMaskMismatch | ReviewError::BandMismatch | ReviewError::SupportMismatch => error("INVALID_LENGTH"),
            ReviewError::EdgeOutOfRange => error("INVALID_INDEX"),
        })?;
        Ok(Diagnosis { revision, layers })
    }
}
