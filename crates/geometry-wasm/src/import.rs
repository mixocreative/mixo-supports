//! Import: the streaming STL sessions, welding, centring and the display decimation.

use super::{coded_error, mesh_error};
use mixo_geometry_core::core::stl::{AsciiStlStream, BinaryStlStream, StlError};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

/// Mutates the caller's vertex buffer and returns center XYZ, then original min/max XYZ.
#[wasm_bindgen]
pub fn center_positions_in_place(positions: &mut [f32]) -> Result<Vec<f64>, JsValue> {
    let centered =
        mixo_geometry_core::core::transform::center_positions(positions).map_err(mesh_error)?;
    Ok(centered
        .center
        .into_iter()
        .chain(centered.bounds.min.into_iter().map(f64::from))
        .chain(centered.bounds.max.into_iter().map(f64::from))
        .collect())
}

#[wasm_bindgen]
pub struct WeldResult {
    pub(crate) positions: Vec<f32>,
    pub(crate) indices: Vec<u32>,
}

#[wasm_bindgen]
pub struct BinaryStlSession {
    stream: Option<BinaryStlStream>,
}

#[wasm_bindgen]
pub struct AsciiStlSession {
    stream: Option<AsciiStlStream>,
}

#[wasm_bindgen]
impl AsciiStlSession {
    #[wasm_bindgen(constructor)]
    pub fn new(file_size: u32) -> Result<Self, JsValue> {
        Ok(Self {
            stream: Some(AsciiStlStream::new(file_size as usize).map_err(stl_error)?),
        })
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), JsValue> {
        self.stream
            .as_mut()
            .ok_or_else(|| coded_error("INVALID_HANDLE"))?
            .push(chunk)
            .map_err(stl_error)
    }

    pub fn finish(&mut self) -> Result<WeldResult, JsValue> {
        let mesh = self
            .stream
            .take()
            .ok_or_else(|| coded_error("INVALID_HANDLE"))?
            .finish()
            .map_err(stl_error)?;
        Ok(WeldResult {
            positions: mesh.positions,
            indices: mesh.indices,
        })
    }
}

#[wasm_bindgen]
impl BinaryStlSession {
    #[wasm_bindgen(constructor)]
    pub fn new(triangles: u32) -> Result<Self, JsValue> {
        Ok(Self {
            stream: Some(BinaryStlStream::new(triangles).map_err(stl_error)?),
        })
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), JsValue> {
        self.stream
            .as_mut()
            .ok_or_else(|| coded_error("INVALID_HANDLE"))?
            .push(chunk)
            .map_err(stl_error)
    }

    pub fn finish(&mut self) -> Result<WeldResult, JsValue> {
        let mesh = self
            .stream
            .take()
            .ok_or_else(|| coded_error("INVALID_HANDLE"))?
            .finish()
            .map_err(stl_error)?;
        Ok(WeldResult {
            positions: mesh.positions,
            indices: mesh.indices,
        })
    }
}

#[wasm_bindgen]
impl WeldResult {
    pub fn take_positions(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.positions)
    }

    pub fn take_indices(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.indices)
    }
}

/// Transforms and welds one raw mesh; empty indices mean sequential corners.
#[wasm_bindgen]
pub fn weld_positions_in_place(
    positions: &mut [f32],
    indices: &[u32],
    matrix: &[f64],
) -> Result<WeldResult, JsValue> {
    let welded =
        mixo_geometry_core::core::weld::weld_positions(positions, indices, matrix).map_err(mesh_error)?;
    Ok(WeldResult {
        positions: welded.positions,
        indices: welded.indices,
    })
}

/// Returns a simplified display copy; the caller keeps the full mesh for support and export.
#[wasm_bindgen]
pub fn decimate_display(
    positions: &[f32],
    indices: &[u32],
    max_triangles: u32,
) -> Result<WeldResult, JsValue> {
    let mesh =
        mixo_geometry_core::core::decimate::decimate_display(positions, indices, max_triangles as usize)
            .map_err(mesh_error)?;
    Ok(WeldResult {
        positions: mesh.positions,
        indices: mesh.indices,
    })
}

fn stl_error(error: StlError) -> JsValue {
    coded_error(match error {
        StlError::Format => "BAD_STL",
        StlError::Empty => "NO_MESH",
        StlError::NonFinite => "NON_FINITE",
        StlError::Capacity => "CAPACITY",
    })
}
