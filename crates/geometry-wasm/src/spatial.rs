//! Spatial queries on the host side: the flat pick index and the ray side flag.

use super::{check_triangles, coded_error};
use mixo_geometry_core::core::spatial::{Bvh, Side};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

/// A mesh's pick index as flat arrays: per node `min xyz, max xyz` (`bounds`) and `start, count`
/// (`links`), then the triangle permutation (`order`). Transferable between realms.
#[wasm_bindgen]
pub struct PickIndex {
    pub(crate) bounds: Vec<f32>,
    pub(crate) links: Vec<u32>,
    pub(crate) order: Vec<u32>,
}

#[wasm_bindgen]
impl PickIndex {
    pub fn take_bounds(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.bounds)
    }
    pub fn take_links(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.links)
    }
    pub fn take_order(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.order)
    }
}

/// The pick index of a mesh outside any session (the import worker builds it once; the main
/// thread loads it with `GeometrySession.load_mesh_indexed`).
#[wasm_bindgen]
pub fn build_pick_index(positions: &[f32], indices: &[u32]) -> Result<PickIndex, JsValue> {
    check_triangles(positions, indices)?;
    let flat = Bvh::build(positions, indices).to_flat();
    Ok(PickIndex { bounds: flat.bounds, links: flat.links, order: flat.order })
}

pub(crate) fn side_of(flag: u32) -> Result<Side, JsValue> {
    Side::from_flag(flag).ok_or_else(|| coded_error("INVALID_ARGUMENT"))
}
