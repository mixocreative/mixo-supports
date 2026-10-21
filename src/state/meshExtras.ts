import type { TriangleMesh } from '../core/analysis/types';

/*
 * What the import worker prepares for the viewport next to a unit's mesh, keyed by mesh object
 * (units are immutable, so a unit keeps its source mesh; undo brings the same object back):
 *   - a simplified display copy for a heavy mesh (the full mesh is still used for supports and export);
 *   - a pick index (three-mesh-bvh, indirect) built off the main thread, for the mesh the viewport draws.
 * WeakMaps: an entry goes when its mesh is collected.
 */

/** `MeshBVH.serialize(bvh, { cloneBuffers: false })` of an indirect BVH, without the index (the mesh has it). */
export interface SerializedBvh {
  roots: ArrayBuffer[];
  indirectBuffer: Uint32Array;
}

const displays = new WeakMap<TriangleMesh, TriangleMesh>();
const bvhs = new WeakMap<TriangleMesh, SerializedBvh>();

export function setDisplayMesh(source: TriangleMesh, display: TriangleMesh): void {
  displays.set(source, display);
}

/** The mesh to draw for `source` (its simplified copy when it has one). */
export function displayMesh(source: TriangleMesh): TriangleMesh {
  return displays.get(source) ?? source;
}

export function setPrebuiltBvh(mesh: TriangleMesh, bvh: SerializedBvh): void {
  bvhs.set(mesh, bvh);
}

export function prebuiltBvh(mesh: TriangleMesh): SerializedBvh | undefined {
  return bvhs.get(mesh);
}
