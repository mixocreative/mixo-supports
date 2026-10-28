//! Thin WebAssembly bindings for the host-independent geometry core.

use mixo_geometry_core::core::mesh::{MeshError, MeshStore};
use mixo_geometry_core::core::brush::{self, BodySegments, Occluder};
use mixo_geometry_core::core::matrix::{self, Handedness};
use mixo_geometry_core::core::spatial::FlatBvh;
use mixo_geometry_core::core::pick;
use mixo_geometry_core::supports::error as support_error;
use std::sync::atomic::{AtomicU32, Ordering};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

mod dental;
mod dental_area;
mod dental_review;
#[cfg(feature = "test-abi")]
mod dental_test_abi;
mod generic;
#[cfg(feature = "test-abi")]
mod generic_test_abi;
mod import;
mod overlay_calls;
mod safety;
mod spatial;
mod transform;

pub(crate) use import::WeldResult;
pub(crate) use overlay_calls::check_triangles;
pub(crate) use spatial::{PickIndex, side_of};
pub(crate) use transform::{handedness_of, matrix4};

#[wasm_bindgen]
pub fn engine_version() -> u32 {
    mixo_geometry_core::engine_version()
}

/// Mesh handles alive across every session of this module instance. A cancelled or finished job
/// must leave it at 0: the lifecycle tests read it.
static LIVE_HANDLES: AtomicU32 = AtomicU32::new(0);

#[wasm_bindgen]
pub fn live_mesh_handles() -> u32 {
    LIVE_HANDLES.load(Ordering::Relaxed)
}

impl Drop for GeometrySession {
    fn drop(&mut self) {
        LIVE_HANDLES.fetch_sub(self.store.handle_count() as u32, Ordering::Relaxed);
    }
}

#[wasm_bindgen]
pub struct GeometrySession {
    store: MeshStore,
    brush_visibility: brush::VisibilityCache,
}

#[wasm_bindgen]
impl GeometrySession {
    #[wasm_bindgen(constructor)]
    pub fn new(max_bytes: u32) -> Self {
        Self {
            store: MeshStore::new(max_bytes as usize),
            brush_visibility: brush::VisibilityCache::default(),
        }
    }

    pub fn load_mesh(&mut self, positions: Vec<f32>, indices: Vec<u32>) -> Result<u32, JsValue> {
        let handle = self.store.load_mesh(positions, indices).map_err(mesh_error)?;
        LIVE_HANDLES.fetch_add(1, Ordering::Relaxed);
        Ok(handle)
    }

    /// `load_mesh` with a pick index built elsewhere (`build_pick_index`, in a worker): used as is,
    /// not rebuilt on the first pick. An index that does not fit the mesh is `INVALID_INDEX`.
    pub fn load_mesh_indexed(&mut self, positions: Vec<f32>, indices: Vec<u32>, bounds: Vec<f32>, links: Vec<u32>, order: Vec<u32>) -> Result<u32, JsValue> {
        let handle = self.store.load_mesh_indexed(positions, indices, FlatBvh { bounds, links, order }).map_err(mesh_error)?;
        LIVE_HANDLES.fetch_add(1, Ordering::Relaxed);
        Ok(handle)
    }

    /// The mesh's pick index as flat arrays (built now if it has none), to hand to another session.
    pub fn pick_index(&mut self, handle: u32) -> Result<PickIndex, JsValue> {
        let flat = self.store.pick_index_flat(handle).map_err(mesh_error)?;
        Ok(PickIndex { bounds: flat.bounds, links: flat.links, order: flat.order })
    }

    pub fn mesh_bounds(&self, handle: u32) -> Result<Vec<f32>, JsValue> {
        let bounds = self.store.bounds(handle).map_err(mesh_error)?;
        Ok([bounds.min, bounds.max].concat())
    }

    pub fn release_mesh(&mut self, handle: u32) -> Result<(), JsValue> {
        // The voxel remesh cache (keyed on mesh bits) may hold this model's state: free it with the mesh.
        mixo_geometry_core::supports::remesh::clear_cache();
        mixo_geometry_core::dental::cache::clear_cache();
        self.store.release_mesh(handle).map_err(mesh_error)?;
        LIVE_HANDLES.fetch_sub(1, Ordering::Relaxed);
        Ok(())
    }

    pub fn used_bytes(&self) -> u32 {
        self.store.used_bytes() as u32
    }

    /// A copy of a loaded mesh placed by `frame` (`[position xyz, rotation xyz]`), loaded as a new
    /// handle in this session: a unit's plate-space model without sending its positions again.
    pub fn load_placed(&mut self, handle: u32, frame: &[f64]) -> Result<u32, JsValue> {
        let frame: [f64; 6] = frame.try_into().map_err(|_| coded_error("INVALID_LENGTH"))?;
        if frame.iter().any(|v| !v.is_finite()) {
            return Err(coded_error("NON_FINITE"));
        }
        let placement = matrix::placement_matrix([frame[0], frame[1], frame[2]], [frame[3], frame[4], frame[5]]);
        let (positions, indices) = self.store.mesh_arrays(handle).map_err(mesh_error)?;
        let placed = matrix::transform_positions(positions, &placement, Handedness::Right);
        let indices = indices.to_vec();
        self.load_mesh(placed, indices)
    }

    /// The mesh's positions through `matrix` (f64[16], column-major); `handedness` 0 keeps the
    /// core frame, 1 mirrors Z for a left-handed host.
    pub fn transform(&self, handle: u32, matrix: &[f64], handedness: u32) -> Result<Vec<f32>, JsValue> {
        let (positions, _) = self.store.mesh_arrays(handle).map_err(mesh_error)?;
        Ok(matrix::transform_positions(positions, &matrix4(matrix)?, handedness_of(handedness)?))
    }

    /// First hit of each ray (origin xyz, direction xyz, mesh-local): 5 floats per ray
    /// (face or -1, distance, x, y, z). `side` 0 front, 1 back, 2 double.
    pub fn pick(&mut self, handle: u32, rays: &[f64], near: f64, far: f64, side: u32) -> Result<Vec<f64>, JsValue> {
        if rays.len() % 6 != 0 {
            return Err(coded_error("INVALID_LENGTH"));
        }
        let side = side_of(side)?;
        self.store.ensure_pick_index(handle).map_err(mesh_error)?;
        let (positions, indices, bvh) = self.store.pick_view(handle).map_err(mesh_error)?;
        Ok(pick::pick_rays(positions, indices, bvh, rays, near, far, side))
    }

    /// `pick` for canvas pixels (x, y pairs, y down); `clip_to_local` inverts projection * view * model.
    #[allow(clippy::too_many_arguments)]
    pub fn pick_pixels(&mut self, handle: u32, clip_to_local: &[f64], width: f64, height: f64, pixels: &[f64], near: f64, far: f64, side: u32) -> Result<Vec<f64>, JsValue> {
        if pixels.len() % 2 != 0 {
            return Err(coded_error("INVALID_LENGTH"));
        }
        let rays = pick::pixel_rays(&matrix4(clip_to_local)?, width, height, pixels);
        self.pick(handle, &rays, near, far, side)
    }

    /// Slots of the support bodies the brush stroke touches and can see (ascending). Occluders are
    /// session meshes with the support-local to model-local matrices (16 f64 each) and sides.
    #[allow(clippy::too_many_arguments)]
    pub fn project_brush(
        &mut self,
        body_points: &[f32],
        body_first: &[u32],
        occluder_handles: &[u32],
        occluder_matrices: &[f64],
        occluder_sides: &[u32],
        matrix: &[f64],
        eye: &[f64],
        size: &[f64],
        radius: f64,
        stroke: &[f64],
        start: u32,
        end: u32,
        want: &[u8],
    ) -> Result<Vec<u32>, JsValue> {
        let slots = body_first.len().saturating_sub(1);
        let ok = body_points.len() % 6 == 0
            && body_first.last().is_none_or(|&last| last as usize * 6 == body_points.len())
            && body_first.windows(2).all(|pair| pair[0] <= pair[1])
            && occluder_matrices.len() == occluder_handles.len() * 16
            && occluder_sides.len() == occluder_handles.len()
            && eye.len() == 3
            && size.len() == 2
            && stroke.len() % 2 == 0
            && (want.is_empty() || want.len() == slots);
        if !ok {
            return Err(coded_error("INVALID_LENGTH"));
        }
        for &handle in occluder_handles {
            self.store.ensure_pick_index(handle).map_err(mesh_error)?;
        }
        let mut occluders = Vec::with_capacity(occluder_handles.len());
        for (k, &handle) in occluder_handles.iter().enumerate() {
            let (positions, indices, bvh) = self.store.pick_view(handle).map_err(mesh_error)?;
            occluders.push(Occluder {
                positions,
                indices,
                bvh,
                to_local: matrix4(&occluder_matrices[k * 16..k * 16 + 16])?,
                side: side_of(occluder_sides[k])?,
            });
        }
        let bodies = BodySegments { keys: (0..slots as u32).collect(), first: body_first.to_vec(), points: body_points.to_vec() };
        let params = brush::Stroke {
            matrix: matrix4(matrix)?,
            width: size[0],
            height: size[1],
            eye: [eye[0], eye[1], eye[2]],
            radius,
            points: stroke,
            start: start as usize,
            end: end as usize,
            want: if want.is_empty() { None } else { Some(want) },
        };
        let key = brush_cache_key(&[body_points_bits(body_points), hash_u32(body_first), hash_u32(occluder_handles), hash_u32(occluder_sides)], &[occluder_matrices, matrix, eye, size]);
        let cache = self.brush_visibility.reuse_for(key);
        Ok(brush::project_brush_cached(&bodies, &occluders, &params, cache))
    }
}

/// One key over everything that decides brush visibility; a change clears the remembered rays.
fn brush_cache_key(parts: &[u64], floats: &[&[f64]]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    parts.hash(&mut hasher);
    for values in floats {
        values.len().hash(&mut hasher);
        values.iter().for_each(|v| v.to_bits().hash(&mut hasher));
    }
    hasher.finish()
}

fn body_points_bits(values: &[f32]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    values.len().hash(&mut hasher);
    values.iter().for_each(|v| v.to_bits().hash(&mut hasher));
    hasher.finish()
}

fn hash_u32(values: &[u32]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    values.hash(&mut hasher);
    hasher.finish()
}

fn mesh_error(error: MeshError) -> JsValue {
    coded_error(error.code())
}

fn build_error(error: mixo_geometry_core::supports::error::BuildError) -> JsValue {
    let exception = coded_error(error.code());
    let detail = match error {
        support_error::BuildError::BadInput(what) | support_error::BuildError::SettingOutOfRange(what) => what.to_string(),
        support_error::BuildError::NotYetPorted(structure) => format!("{structure:?}"),
    };
    let _ = js_sys::Reflect::set(&exception, &JsValue::from_str("detail"), &JsValue::from_str(&detail));
    exception
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
