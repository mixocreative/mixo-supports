import type { TriangleMesh } from '../core/analysis/types';
import { assertTriangleCapacity, meshTier, TRIANGLE_BUDGET, type Runtime } from '../core/budget';
import type { ImportedMesh, RawMesh } from '../state/import';
import type { PreparedMesh } from './importProtocol';
import type { GeometryEngine } from './geometryClient';
import { nonFiniteError } from './stlSession';

export type Progress = (fraction: number, stage: string) => void;

/** Bulk glTF position transform and first-seen weld, preserving the existing import result. */
export function weldRawWithWasm(raw: RawMesh, engine: GeometryEngine): ImportedMesh {
  try {
    const result = engine.weld_positions_in_place(raw.positions, raw.indices ?? new Uint32Array(), new Float64Array(raw.matrix));
    try {
      return { name: raw.name, mesh: { positions: result.take_positions(), indices: result.take_indices() } };
    } finally {
      result.free();
    }
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'NON_FINITE') {
      throw nonFiniteError(raw.name);
    }
    throw error;
  }
}

/** The import worker uses this bulk WASM operation; no per-vertex JS/WASM calls. */
export function centerImportedWithWasm(item: ImportedMesh, engine: GeometryEngine): ImportedMesh {
  const data = engine.center_positions_in_place(item.mesh.positions);
  const triplet = (offset: number): [number, number, number] => [data[offset]!, data[offset + 1]!, data[offset + 2]!];
  return { ...item, centred: { center: triplet(0), bounds: { min: triplet(3), max: triplet(6) } } };
}

/** Keep only one Rust result copy; the full-resolution input remains the support/export source. */
export function decimateWithWasm(mesh: TriangleMesh, engine: Pick<GeometryEngine, 'decimate_display'>, maxTriangles: number): TriangleMesh {
  const result = engine.decimate_display(mesh.positions, mesh.indices, maxTriangles);
  try {
    return { positions: result.take_positions(), indices: result.take_indices() };
  } finally {
    result.free();
  }
}

/** Centre, check the size, simplify a heavy mesh for display. */
export function prepare(item: ImportedMesh, runtime: Runtime, progress: Progress, center: (item: ImportedMesh) => ImportedMesh, simplify: (mesh: TriangleMesh, maxTriangles: number) => TriangleMesh): PreparedMesh {
  const triangles = item.mesh.indices.length / 3;
  // Backstop for formats estimated (or not counted) before parsing.
  assertTriangleCapacity(item.name, triangles, runtime, true);
  const centred = center(item);
  let display: TriangleMesh | undefined;
  if (meshTier(triangles, runtime) === 'heavy') {
    progress(0.8, 'Simplifying display copy');
    display = simplify(centred.mesh, Math.floor(TRIANGLE_BUDGET[runtime] / 2));
  }
  return { ...centred, ...(display ? { display } : {}) };
}

/** Every buffer of the prepared meshes, each once, to transfer. */
export function buffers(prepared: PreparedMesh[]): Transferable[] {
  return prepared.flatMap(({ mesh, display, pickIndex }) => [
    mesh.positions.buffer,
    mesh.indices.buffer,
    ...(display ? [display.positions.buffer, display.indices.buffer] : []),
    ...(pickIndex ? [pickIndex.bounds.buffer, pickIndex.links.buffer, pickIndex.order.buffer] : []),
  ]);
}

