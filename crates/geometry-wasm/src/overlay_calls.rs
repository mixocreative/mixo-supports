//! Mesh-wide derived data for the viewport: vertex normals, support body segments, the refined
//! display copy for the zone layer and the face-mask overlay.

use super::WeldResult;
use super::coded_error;
use mixo_geometry_core::core::{normals, overlay};
use mixo_geometry_core::core::brush;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

#[wasm_bindgen]
pub fn vertex_normals(positions: &[f32], indices: &[u32]) -> Result<Vec<f32>, JsValue> {
    check_triangles(positions, indices)?;
    Ok(normals::vertex_normals(positions, indices))
}

pub(crate) fn check_triangles(positions: &[f32], indices: &[u32]) -> Result<(), JsValue> {
    if positions.len() % 3 != 0 || indices.len() % 3 != 0 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    if indices.iter().any(|&i| i as usize >= positions.len() / 3) {
        return Err(coded_error("INVALID_INDEX"));
    }
    Ok(())
}

#[wasm_bindgen]
pub struct BodySegmentsResult {
    keys: Vec<u32>,
    first: Vec<u32>,
    points: Vec<f32>,
}

#[wasm_bindgen]
impl BodySegmentsResult {
    pub fn take_keys(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.keys)
    }
    pub fn take_first(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.first)
    }
    pub fn take_points(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.points)
    }
}

/// Support bodies as axis segments; component `k` covers `indices[start[k] .. start[k] + count[k]]`
/// and belongs to contact key `contact[k]` (`0xFFFFFFFF` for none).
#[wasm_bindgen]
pub fn body_segments(positions: &[f32], indices: &[u32], contact: &[u32], start: &[u32], count: &[u32]) -> Result<BodySegmentsResult, JsValue> {
    check_triangles(positions, indices)?;
    let ranges_ok = contact.len() == start.len()
        && contact.len() == count.len()
        && start.iter().zip(count).all(|(&s, &c)| s as usize + c as usize <= indices.len());
    if !ranges_ok {
        return Err(coded_error("INVALID_LENGTH"));
    }
    let bodies = brush::body_segments(positions, indices, contact, start, count);
    Ok(BodySegmentsResult { keys: bodies.keys, first: bodies.first, points: bodies.points })
}

/// A finer display copy of a mesh for the zone layer (the input when it already fits).
#[wasm_bindgen]
pub fn refine_for_overlay(positions: &[f32], indices: &[u32], max_edge: f64, max_triangles: u32) -> Result<WeldResult, JsValue> {
    check_triangles(positions, indices)?;
    let (positions, indices) = overlay::refine_for_overlay(positions, indices, max_edge, max_triangles as usize);
    Ok(WeldResult { positions, indices })
}

/// Per-corner positions and flat normals of the approved faces (`allowed[face] == 1`).
#[wasm_bindgen]
pub struct FaceOverlay {
    positions: Vec<f32>,
    normals: Vec<f32>,
}

#[wasm_bindgen]
impl FaceOverlay {
    pub fn take_positions(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.positions)
    }
    pub fn take_normals(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.normals)
    }
}

#[wasm_bindgen]
pub fn face_mask_overlay(positions: &[f32], indices: &[u32], allowed: &[u8]) -> Result<FaceOverlay, JsValue> {
    check_triangles(positions, indices)?;
    let (positions, normals) = overlay::face_mask_overlay(positions, indices, allowed).ok_or_else(|| coded_error("INVALID_LENGTH"))?;
    Ok(FaceOverlay { positions, normals })
}

#[wasm_bindgen]
pub fn face_mask_contour_segments(positions: &[f32], pairs: &[u32]) -> Result<Vec<f32>, JsValue> {
    if positions.len() % 3 != 0 || pairs.iter().any(|&i| i as usize * 3 + 3 > positions.len()) {
        return Err(coded_error("INVALID_INDEX"));
    }
    Ok(overlay::face_mask_contour_segments(positions, pairs))
}
