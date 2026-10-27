import { useLayoutEffect, useState } from 'react';
import * as THREE from 'three';
import type { TriangleMesh } from '../../core/analysis/types';

export function toGeometry(mesh: TriangleMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * GPU geometry for a mesh, freed when the mesh changes or the view unmounts. Pointer raycasts
 * run on the Rust pick index (`rustRaycast`), which builds on a mesh's first ray.
 */
export function useGeometry(mesh: TriangleMesh | undefined): THREE.BufferGeometry | undefined {
  // Built in the effect, not memoised, like `SupportBodies`: StrictMode runs mount, cleanup, mount
  // on one render, and a memoised geometry would live on after the cleanup disposed it. A layout
  // effect, so the render with the new geometry follows before any frame is drawn; until then
  // (a new mesh) there is none, never one of another mesh.
  const [built, setBuilt] = useState<{ mesh: TriangleMesh; geometry: THREE.BufferGeometry }>();
  useLayoutEffect(() => {
    if (!mesh || mesh.indices.length === 0) {
      setBuilt(undefined);
      return;
    }
    const next = { mesh, geometry: toGeometry(mesh) };
    setBuilt(next);
    return () => next.geometry.dispose();
  }, [mesh]);
  return built && built.mesh === mesh ? built.geometry : undefined;
}
