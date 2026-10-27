//! Thin WebAssembly bindings for the host-independent geometry core.

use mixo_geometry_core::core::mesh::{MeshError, MeshStore};
use mixo_geometry_core::core::stl::{AsciiStlStream, BinaryStlStream, StlError};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

#[wasm_bindgen]
pub fn engine_version() -> u32 {
    mixo_geometry_core::engine_version()
}

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
    positions: Vec<f32>,
    indices: Vec<u32>,
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

#[wasm_bindgen]
pub struct GeometrySession {
    store: MeshStore,
}

#[wasm_bindgen]
impl GeometrySession {
    #[wasm_bindgen(constructor)]
    pub fn new(max_bytes: u32) -> Self {
        Self {
            store: MeshStore::new(max_bytes as usize),
        }
    }

    pub fn load_mesh(&mut self, positions: Vec<f32>, indices: Vec<u32>) -> Result<u32, JsValue> {
        self.store.load_mesh(positions, indices).map_err(mesh_error)
    }

    pub fn mesh_bounds(&self, handle: u32) -> Result<Vec<f32>, JsValue> {
        let bounds = self.store.bounds(handle).map_err(mesh_error)?;
        Ok([bounds.min, bounds.max].concat())
    }

    pub fn release_mesh(&mut self, handle: u32) -> Result<(), JsValue> {
        self.store.release_mesh(handle).map_err(mesh_error)
    }

    pub fn used_bytes(&self) -> u32 {
        self.store.used_bytes() as u32
    }
}

fn mesh_error(error: MeshError) -> JsValue {
    coded_error(error.code())
}

fn stl_error(error: StlError) -> JsValue {
    coded_error(match error {
        StlError::Format => "BAD_STL",
        StlError::Empty => "NO_MESH",
        StlError::NonFinite => "NON_FINITE",
        StlError::Capacity => "CAPACITY",
    })
}

fn coded_error(code: &str) -> JsValue {
    let exception = js_sys::Error::new(code);
    let _ = js_sys::Reflect::set(
        exception.as_ref(),
        &JsValue::from_str("code"),
        &JsValue::from_str(code),
    );
    exception.into()
}

#[cfg(test)]
mod tests {
    use super::engine_version;

    #[test]
    fn reports_the_core_contract_version() {
        assert_eq!(engine_version(), mixo_geometry_core::engine_version());
    }
}
