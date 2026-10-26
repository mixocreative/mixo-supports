//! Thin WebAssembly bindings for the host-independent geometry core.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn engine_version() -> u32 {
    mixo_geometry_core::engine_version()
}

#[cfg(test)]
mod tests {
    use super::engine_version;

    #[test]
    fn reports_the_core_contract_version() {
        assert_eq!(engine_version(), mixo_geometry_core::engine_version());
    }
}
