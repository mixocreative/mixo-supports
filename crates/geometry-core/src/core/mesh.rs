use super::spatial::Bvh;
use std::collections::BTreeMap;

#[derive(Debug, PartialEq, Eq)]
pub enum MeshError {
    InvalidLength,
    NonFinite,
    InvalidIndex,
    Capacity,
    InvalidHandle,
}

impl MeshError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidLength => "INVALID_LENGTH",
            Self::NonFinite => "NON_FINITE",
            Self::InvalidIndex => "INVALID_INDEX",
            Self::Capacity => "CAPACITY",
            Self::InvalidHandle => "INVALID_HANDLE",
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct Bounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

struct Mesh {
    positions: Vec<f32>,
    indices: Vec<u32>,
    /// Pick index, built on first use.
    bvh: Option<Bvh>,
}

pub struct MeshStore {
    max_bytes: usize,
    used_bytes: usize,
    next_id: u32,
    meshes: BTreeMap<u32, Mesh>,
}

impl MeshStore {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            used_bytes: 0,
            next_id: 1,
            meshes: BTreeMap::new(),
        }
    }

    pub fn used_bytes(&self) -> usize {
        self.used_bytes
    }

    pub fn load_mesh(&mut self, positions: Vec<f32>, indices: Vec<u32>) -> Result<u32, MeshError> {
        if positions.is_empty()
            || indices.is_empty()
            || positions.len() % 3 != 0
            || indices.len() % 3 != 0
        {
            return Err(MeshError::InvalidLength);
        }
        if positions.iter().any(|coordinate| !coordinate.is_finite()) {
            return Err(MeshError::NonFinite);
        }
        if indices
            .iter()
            .any(|&index| index as usize >= positions.len() / 3)
        {
            return Err(MeshError::InvalidIndex);
        }
        let bytes = positions
            .len()
            .checked_add(indices.len())
            .and_then(|elements| elements.checked_mul(4))
            .ok_or(MeshError::Capacity)?;
        if bytes > self.max_bytes.saturating_sub(self.used_bytes) {
            return Err(MeshError::Capacity);
        }
        let handle = self.next_id;
        self.next_id = self.next_id.checked_add(1).ok_or(MeshError::Capacity)?;
        self.used_bytes += bytes;
        self.meshes.insert(handle, Mesh { positions, indices, bvh: None });
        Ok(handle)
    }

    pub fn bounds(&self, handle: u32) -> Result<Bounds, MeshError> {
        let mesh = self.meshes.get(&handle).ok_or(MeshError::InvalidHandle)?;
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for point in mesh.positions.chunks_exact(3) {
            for axis in 0..3 {
                min[axis] = min[axis].min(point[axis]);
                max[axis] = max[axis].max(point[axis]);
            }
        }
        Ok(Bounds { min, max })
    }

    /// The mesh's raw arrays.
    pub fn mesh_arrays(&self, handle: u32) -> Result<(&[f32], &[u32]), MeshError> {
        let mesh = self.meshes.get(&handle).ok_or(MeshError::InvalidHandle)?;
        Ok((&mesh.positions, &mesh.indices))
    }

    /// Builds the mesh's pick index if it has none yet.
    pub fn ensure_pick_index(&mut self, handle: u32) -> Result<(), MeshError> {
        let mesh = self.meshes.get_mut(&handle).ok_or(MeshError::InvalidHandle)?;
        if mesh.bvh.is_none() {
            mesh.bvh = Some(Bvh::build(&mesh.positions, &mesh.indices));
        }
        Ok(())
    }

    /// The mesh's arrays and its pick index (call `ensure_pick_index` first).
    pub fn pick_view(&self, handle: u32) -> Result<(&[f32], &[u32], &Bvh), MeshError> {
        let mesh = self.meshes.get(&handle).ok_or(MeshError::InvalidHandle)?;
        let bvh = mesh.bvh.as_ref().ok_or(MeshError::InvalidHandle)?;
        Ok((&mesh.positions, &mesh.indices, bvh))
    }

    pub fn release_mesh(&mut self, handle: u32) -> Result<(), MeshError> {
        let mesh = self
            .meshes
            .remove(&handle)
            .ok_or(MeshError::InvalidHandle)?;
        self.used_bytes -= (mesh.positions.len() + mesh.indices.len()) * 4;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{Bounds, MeshError, MeshStore};

    fn triangle() -> (Vec<f32>, Vec<u32>) {
        (vec![0., 0., 0., 2., 0., 0., 0., 3., 0.], vec![0, 1, 2])
    }

    #[test]
    fn loads_bounds_and_releases_one_mesh() {
        let mut store = MeshStore::new(48);
        let (positions, indices) = triangle();
        let handle = store.load_mesh(positions, indices).unwrap();
        assert_eq!(store.used_bytes(), 48);
        assert_eq!(
            store.bounds(handle).unwrap(),
            Bounds {
                min: [0., 0., 0.],
                max: [2., 3., 0.]
            }
        );
        store.release_mesh(handle).unwrap();
        assert_eq!(store.used_bytes(), 0);
        assert_eq!(store.bounds(handle), Err(MeshError::InvalidHandle));
    }

    #[test]
    fn rejects_over_budget_without_retaining_bytes() {
        let mut store = MeshStore::new(47);
        let (positions, indices) = triangle();
        assert_eq!(
            store.load_mesh(positions, indices),
            Err(MeshError::Capacity)
        );
        assert_eq!(store.used_bytes(), 0);
    }

    #[test]
    fn rejects_malformed_arrays_before_allocating_a_handle() {
        let mut store = MeshStore::new(1000);
        assert_eq!(
            store.load_mesh(vec![0., 1.], vec![0, 1, 2]),
            Err(MeshError::InvalidLength)
        );
        assert_eq!(
            store.load_mesh(vec![0., 0., f32::NAN], vec![0, 0, 0]),
            Err(MeshError::NonFinite)
        );
        let (positions, _) = triangle();
        assert_eq!(
            store.load_mesh(positions, vec![0, 1, 3]),
            Err(MeshError::InvalidIndex)
        );
        assert_eq!(store.used_bytes(), 0);
    }

    #[test]
    fn released_handle_is_never_reused() {
        let mut store = MeshStore::new(96);
        let (positions, indices) = triangle();
        let first = store.load_mesh(positions, indices).unwrap();
        store.release_mesh(first).unwrap();
        let (positions, indices) = triangle();
        let second = store.load_mesh(positions, indices).unwrap();
        assert_ne!(first, second);
        assert_eq!(store.release_mesh(first), Err(MeshError::InvalidHandle));
    }
}
