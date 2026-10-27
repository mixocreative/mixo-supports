import type * as THREE from 'three';
import { sharedSession } from '../../workers/geometryClient';
import { pickIndexFor } from '../../workers/pickIndexes';

/**
 * Meshes of three.js geometries in the shared Rust session, by geometry: loaded on first use and
 * released when the geometry is disposed (positions and index are read-only, so the copy in the
 * engine stays true to the geometry).
 */
const handles = new WeakMap<THREE.BufferGeometry, number>();

/** The session handle of a geometry's mesh; undefined before the engine is ready or for a geometry without triangles. */
export function sessionHandle(geometry: THREE.BufferGeometry): number | undefined {
  const known = handles.get(geometry);
  if (known !== undefined) return known;
  const session = sharedSession();
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  if (!session || !position || !index || index.count === 0 || !(position.array instanceof Float32Array) || !(index.array instanceof Uint32Array || index.array instanceof Uint16Array)) return undefined;
  const handle = loadWithIndex(session, position.array, Uint32Array.from(index.array));
  handles.set(geometry, handle);
  const release = () => {
    geometry.removeEventListener('dispose', release);
    handles.delete(geometry);
    try { sharedSession()?.release_mesh(handle); } catch { /* already released */ }
  };
  geometry.addEventListener('dispose', release);
  return handle;
}

/** Loads the mesh with the pick index the import worker built for these arrays, if any (a refused one just builds lazily). */
function loadWithIndex(session: NonNullable<ReturnType<typeof sharedSession>>, positions: Float32Array, indices: Uint32Array): number {
  const built = pickIndexFor(positions);
  if (built) {
    try { return session.load_mesh_indexed(positions, indices, built.bounds, built.links, built.order); } catch { /* does not fit: build on first pick */ }
  }
  return session.load_mesh(positions, indices);
}
