//! Thin WebAssembly bindings for the host-independent geometry core.

use mixo_geometry_core::mesh::{MeshError, MeshStore};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

#[wasm_bindgen]
pub fn engine_version() -> u32 {
    mixo_geometry_core::engine_version()
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
    let exception = js_sys::Error::new(error.code());
    let _ = js_sys::Reflect::set(
        exception.as_ref(),
        &JsValue::from_str("code"),
        &JsValue::from_str(error.code()),
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
