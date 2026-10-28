//! Thin WebAssembly bindings for the host-independent geometry core.

use mixo_geometry_core::core::mesh::{MeshError, MeshStore};
use mixo_geometry_core::core::stl::{AsciiStlStream, BinaryStlStream, StlError};
use mixo_geometry_core::core::brush::{self, BodySegments, Occluder};
use mixo_geometry_core::core::matrix::{self, Handedness, Matrix4};
use mixo_geometry_core::core::spatial::{Bvh, FlatBvh, Side};
use mixo_geometry_core::core::{normals, overlay, pick};
use mixo_geometry_core::supports::error as support_error;
use std::sync::atomic::{AtomicU32, Ordering};
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

mod dental;
#[cfg(feature = "test-abi")]
mod dental_test_abi;
mod generic;
#[cfg(feature = "test-abi")]
mod generic_test_abi;
mod safety;

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

/// A mesh's pick index as flat arrays: per node `min xyz, max xyz` (`bounds`) and `start, count`
/// (`links`), then the triangle permutation (`order`). Transferable between realms.
#[wasm_bindgen]
pub struct PickIndex {
    bounds: Vec<f32>,
    links: Vec<u32>,
    order: Vec<u32>,
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

fn matrix4(values: &[f64]) -> Result<Matrix4, JsValue> {
    let matrix: Matrix4 = values.try_into().map_err(|_| coded_error("INVALID_LENGTH"))?;
    if matrix.iter().any(|v| !v.is_finite()) {
        return Err(coded_error("NON_FINITE"));
    }
    Ok(matrix)
}

fn handedness_of(flag: u32) -> Result<Handedness, JsValue> {
    Handedness::from_flag(flag).ok_or_else(|| coded_error("INVALID_ARGUMENT"))
}

fn side_of(flag: u32) -> Result<Side, JsValue> {
    Side::from_flag(flag).ok_or_else(|| coded_error("INVALID_ARGUMENT"))
}

/// Placement matrix (f64[16]) of a position (mm) and Euler XYZ rotation (radians).
#[wasm_bindgen]
pub fn placement_matrix(position: &[f64], rotation: &[f64]) -> Result<Vec<f64>, JsValue> {
    if position.len() != 3 || rotation.len() != 3 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(matrix::placement_matrix([position[0], position[1], position[2]], [rotation[0], rotation[1], rotation[2]]).to_vec())
}

#[wasm_bindgen]
pub fn invert_matrix(matrix: &[f64]) -> Result<Vec<f64>, JsValue> {
    Ok(matrix::invert_matrix(&matrix4(matrix)?).to_vec())
}

/// Positions of any mesh (not necessarily in a session) through a matrix; see `GeometrySession.transform`.
#[wasm_bindgen]
pub fn transform_positions(positions: &[f32], matrix: &[f64], handedness: u32) -> Result<Vec<f32>, JsValue> {
    if positions.len() % 3 != 0 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(matrix::transform_positions(positions, &matrix4(matrix)?, handedness_of(handedness)?))
}

/// Lowest y of the positions through a matrix (float32 like `transform_positions`), without the copy.
#[wasm_bindgen]
pub fn transformed_min_y(positions: &[f32], matrix: &[f64]) -> Result<f32, JsValue> {
    if positions.len() % 3 != 0 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(matrix::transformed_min_y(positions, &matrix4(matrix)?))
}

/// A batch of f64 xyz triples through a matrix as points (with divide) or normalised directions.
#[wasm_bindgen]
pub fn transform_vectors(values: &[f64], matrix: &[f64], direction: bool) -> Result<Vec<f64>, JsValue> {
    if values.len() % 3 != 0 {
        return Err(coded_error("INVALID_LENGTH"));
    }
    Ok(matrix::transform_vectors(values, &matrix4(matrix)?, direction))
}

#[wasm_bindgen]
pub fn vertex_normals(positions: &[f32], indices: &[u32]) -> Result<Vec<f32>, JsValue> {
    check_triangles(positions, indices)?;
    Ok(normals::vertex_normals(positions, indices))
}

fn check_triangles(positions: &[f32], indices: &[u32]) -> Result<(), JsValue> {
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
