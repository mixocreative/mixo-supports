import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { TriangleMesh } from '../core/analysis/types';
import { assertTriangleCapacity, meshTier, TRIANGLE_BUDGET, type Runtime } from '../core/budget';
import { decimate } from '../core/decimate';
import { centreInPlace, type ImportedMesh } from '../state/import';
import type { SerializedBvh } from '../state/meshExtras';
import type { PreparedMesh } from './importProtocol';

export type Progress = (fraction: number, stage: string) => void;

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
export function prepare(item: ImportedMesh, runtime: Runtime, progress: Progress, from: number, to: number): PreparedMesh {
  const triangles = item.mesh.indices.length / 3;
  // Backstop for formats estimated (or not counted) before parsing.
  assertTriangleCapacity(item.name, triangles, runtime, true);
  const centred = centreInPlace(item);
  let display: TriangleMesh | undefined;
  if (meshTier(triangles, runtime) === 'heavy') {
    progress(from, 'Simplifying display copy');
    display = decimate(centred.mesh, Math.floor(TRIANGLE_BUDGET[runtime] / 2));
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

