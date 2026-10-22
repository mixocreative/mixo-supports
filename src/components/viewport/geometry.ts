import { useEffect, useLayoutEffect, useState } from 'react';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, MeshBVH } from 'three-mesh-bvh';
import type { TriangleMesh } from '../../core/analysis/types';
import { prebuiltBvh } from '../../state/meshExtras';

export function toGeometry(mesh: TriangleMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * GPU geometry for a mesh, freed when the mesh changes or the view unmounts. With `bvh` a
 * bounding volume hierarchy makes pointer raycasts cheap on big meshes (models always;
 * supports only while edited, the only time they take pointer events).
 */
export function useGeometry(mesh: TriangleMesh | undefined, bvh: boolean): THREE.BufferGeometry | undefined {
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
  const geometry = built && built.mesh === mesh ? built.geometry : undefined;
  useEffect(() => {
    if (!geometry || !bvh) return;
    geometry.computeBoundsTree = computeBoundsTree;
    geometry.disposeBoundsTree = disposeBoundsTree;
    // A model's index comes built by the import worker (never on the main thread); read-only, so
    // geometries of the same mesh can share it.
    const prebuilt = mesh && prebuiltBvh(mesh);
    if (prebuilt) geometry.boundsTree = MeshBVH.deserialize({ ...prebuilt, index: mesh.indices } as unknown as Parameters<typeof MeshBVH.deserialize>[0], geometry, { setIndex: false });
    // Indirect: a default build reorders the index buffer in place (it is the mesh's own
    // array), which breaks the triangle → support contact lookup and mutates scene data.
    // (0.7.8 supports the option; its typings do not list it yet.)
    else geometry.computeBoundsTree({ indirect: true } as Parameters<typeof computeBoundsTree>[0]);
    return () => geometry.disposeBoundsTree?.();
  }, [geometry, bvh]); // eslint-disable-line react-hooks/exhaustive-deps
  return geometry;
}
