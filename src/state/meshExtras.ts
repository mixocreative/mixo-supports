import type { TriangleMesh } from '../core/analysis/types';

/*
 * What the import worker prepares for the viewport next to a unit's mesh, keyed by mesh object
 * (units are immutable, so a unit keeps its source mesh; undo brings the same object back):
 *   - a simplified display copy for a heavy mesh (the full mesh is still used for supports and export).
 * A WeakMap: an entry goes when its mesh is collected.
 */

const displays = new WeakMap<TriangleMesh, TriangleMesh>();

export function setDisplayMesh(source: TriangleMesh, display: TriangleMesh): void {
  displays.set(source, display);
}

/** The mesh to draw for `source` (its simplified copy when it has one). */
export function displayMesh(source: TriangleMesh): TriangleMesh {
  return displays.get(source) ?? source;
}
