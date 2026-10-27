//! Voxel remesh of the model as Blender's Mesh to SDF Grid + Grid to Mesh builds it (port of the TS
//! oracle `remesh.ts`, split by responsibility), reproduced from OpenVDB's VolumeToMesh around the
//! points that are queried. Landing rays, neck normals, the Safe Distance scatter and the generic
//! placement's Poisson field and minima read it. Lives in `supports/` because the support builder
//! lands columns on it; the generic policy only consumes it.

mod full;
mod grid;
mod leaf;
mod num;
mod prims;
mod query;
mod sdf;
mod tables;

pub use full::FullMesh;
pub use grid::Remesh;
pub use num::{V3, fr, hypot, hypot3, js_round};
pub use query::{NormalKind, fan};
pub use sdf::{SignedDistance, closest_on_triangle};

pub(crate) const LEAF: i32 = 8;

/// The identity of a remesh point: a cell's own point (one per edge group) or a merged region's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PointId {
    Cell([i32; 3], u8),
    Region([i32; 3], u32),
}

/// A face as OpenVDB emits it: point identities in output order.
pub(crate) struct Prim {
    pub ids: Vec<PointId>,
    pub triangle: bool,
}

/// A face of the remesh in web space; `id` is the primitive it came from.
pub struct Polygon {
    pub id: usize,
    pub corners: Vec<V3>,
    pub vertices: Vec<PointId>,
    pub normal: V3,
}
