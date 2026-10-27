import type { TriangleMesh } from '../../core/analysis/types';
import { supportEngine } from '../../supports/supportEngine';
import { buildVertexGrid, type VertexGrid } from '../../core/supports/zones';

/**
 * A finer copy of a mesh for display-only overlays (the no-support zone layer): per-vertex
 * colours cannot show a 2 mm brush dab on a face made of a few large triangles. The refinement is
 * the Rust `refine_for_overlay` (core/overlay.rs): every edge longer than `maxEdge` is split at its
 * midpoint, longest first while the result stays within `maxTriangles`, no cracks, original
 * vertices first and unchanged, winding kept. A mesh that already fits is returned as is. Picking
 * and support logic keep the original.
 */
export function refineForOverlay(mesh: TriangleMesh, maxEdge: number, maxTriangles: number): TriangleMesh {
  const result = supportEngine().refine_for_overlay(mesh.positions, mesh.indices, maxEdge, Math.min(maxTriangles, 0xffffffff));
  try {
    const indices = result.take_indices();
    return indices.length === mesh.indices.length ? mesh : { positions: result.take_positions(), indices };
  } finally {
    result.free();
  }
}

interface ZoneOverlay {
  /** `refineForOverlay` of the mesh (the mesh itself when it already fits). */
  mesh: TriangleMesh;
  /** Vertex grid over `mesh` (none for non-finite coordinates, see `buildVertexGrid`). */
  grid: VertexGrid | undefined;
}

const overlays = new WeakMap<TriangleMesh, { key: string; overlay: ZoneOverlay }>();

/**
 * The no-support zone layer's mesh and vertex grid for a model, worked out once per mesh object
 * (meshes are never changed in place), so reopening the layer on the same model costs nothing.
 */
export function zoneOverlay(mesh: TriangleMesh, maxEdge: number, maxTriangles: number, cellSize: number): ZoneOverlay {
  const key = `${maxEdge}:${maxTriangles}:${cellSize}`;
  const cached = overlays.get(mesh);
  if (cached?.key === key) return cached.overlay;
  const refined = refineForOverlay(mesh, maxEdge, maxTriangles);
  const overlay = { mesh: refined, grid: buildVertexGrid(refined.positions, cellSize) };
  overlays.set(mesh, { key, overlay });
  return overlay;
}

/** Works `zoneOverlay` out ahead of the first zone stroke; the one `step` does it all and says nothing remains. */
export function warmZoneOverlay(mesh: TriangleMesh, maxEdge: number, maxTriangles: number, cellSize: number): () => boolean {
  return () => {
    zoneOverlay(mesh, maxEdge, maxTriangles, cellSize);
    return false;
  };
}
