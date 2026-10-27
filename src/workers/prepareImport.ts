import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { TriangleMesh } from '../core/analysis/types';
import { assertTriangleCapacity, meshTier, TRIANGLE_BUDGET, type Runtime } from '../core/budget';
import type { ImportedMesh, RawMesh } from '../state/import';
import type { SerializedBvh } from '../state/meshExtras';
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

/** The pick index of a mesh as the viewport reads it (three-mesh-bvh, indirect: the mesh's own index array is never reordered). */
export function buildPickIndex(mesh: TriangleMesh, onProgress?: (fraction: number) => void): SerializedBvh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const options = { indirect: true, ...(onProgress ? { onProgress } : {}) };
  const bvh = new MeshBVH(geometry, options as ConstructorParameters<typeof MeshBVH>[1]);
  const { roots, indirectBuffer } = MeshBVH.serialize(bvh, { cloneBuffers: false }) as unknown as SerializedBvh;
  return { roots, indirectBuffer };
}

/** Centre, check the size, simplify a heavy mesh for display, build the pick index of what is drawn. */
export function prepare(item: ImportedMesh, runtime: Runtime, progress: Progress, from: number, to: number, center: (item: ImportedMesh) => ImportedMesh, simplify: (mesh: TriangleMesh, maxTriangles: number) => TriangleMesh): PreparedMesh {
  const triangles = item.mesh.indices.length / 3;
  // Backstop for formats estimated (or not counted) before parsing.
  assertTriangleCapacity(item.name, triangles, runtime, true);
  const centred = center(item);
  let display: TriangleMesh | undefined;
  if (meshTier(triangles, runtime) === 'heavy') {
    progress(from, 'Simplifying display copy');
    display = simplify(centred.mesh, Math.floor(TRIANGLE_BUDGET[runtime] / 2));
  }
  const drawn = display ?? centred.mesh;
  const span = to - from;
  progress(from + span * 0.2, 'Building pick index');
  const bvh = buildPickIndex(drawn, (fraction) => progress(from + span * (0.2 + 0.8 * fraction), 'Building pick index'));
  return { ...centred, ...(display ? { display } : {}), bvh };
}

/** Every buffer of the prepared meshes, each once, to transfer. */
export function buffers(prepared: PreparedMesh[]): Transferable[] {
  return prepared.flatMap(({ mesh, display, bvh }) => [
    mesh.positions.buffer,
    mesh.indices.buffer,
    ...(display ? [display.positions.buffer, display.indices.buffer] : []),
    ...bvh.roots,
    bvh.indirectBuffer.buffer,
  ]);
}

