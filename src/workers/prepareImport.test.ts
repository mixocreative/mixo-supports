import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, TorusKnotGeometry, Vector3 } from 'three';
import { acceleratedRaycast, computeBoundsTree, MeshBVH } from 'three-mesh-bvh';
import { centreInPlace, geometryToMesh } from '../state/import';
import { buffers, prepare } from './prepareImport';
import { decimate } from '../core/decimate';

/** A pickable mesh on `geometry` (accelerated raycast, first hit only, as the viewport picks). */
function pickable(geometry: BufferGeometry): Mesh {
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.raycast = acceleratedRaycast;
  return mesh;
}

describe('import worker pick index (serialise → transfer → deserialise)', () => {
  it('raycasts exactly like an index built on the main thread, and leaves the index buffer as it was', () => {
    const imported = geometryToMesh(new TorusKnotGeometry(10, 3, 600, 60)); // 72,000 triangles: a Uint32 indirect buffer
    const prepared = prepare({ name: 'knot', mesh: imported }, 'web', () => {}, 0, 1, centreInPlace, decimate);
    const indicesBefore = prepared.mesh.indices.slice();
    // What the transfer does to the buffers: the main thread gets copies it owns.
    const sent = structuredClone({ mesh: prepared.mesh, bvh: prepared.bvh }, { transfer: buffers([prepared]) as Transferable[] });

    const fromWorker = new BufferGeometry();
    fromWorker.setAttribute('position', new BufferAttribute(sent.mesh.positions, 3));
    fromWorker.setIndex(new BufferAttribute(sent.mesh.indices, 1));
    (fromWorker as BufferGeometry & { boundsTree?: unknown }).boundsTree = MeshBVH.deserialize({ ...sent.bvh, index: sent.mesh.indices } as unknown as Parameters<typeof MeshBVH.deserialize>[0], fromWorker, { setIndex: false });

    const reference = new BufferGeometry();
    reference.setAttribute('position', new BufferAttribute(sent.mesh.positions.slice(), 3));
    reference.setIndex(new BufferAttribute(sent.mesh.indices.slice(), 1));
    (reference as BufferGeometry & { computeBoundsTree?: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
    (reference as unknown as { computeBoundsTree(options: object): void }).computeBoundsTree({ indirect: true });

    const raycaster = new Raycaster();
    (raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const [a, b] = [pickable(fromWorker), pickable(reference)];
    let hits = 0;
    for (let k = 0; k < 200; k += 1) {
      const angle = (k / 200) * Math.PI * 2;
      raycaster.set(new Vector3(40 * Math.cos(angle), (k % 20) - 10, 40 * Math.sin(angle)), new Vector3(-Math.cos(angle), 0, -Math.sin(angle)));
      const [hitA] = raycaster.intersectObject(a);
      const [hitB] = raycaster.intersectObject(b);
      expect(hitA?.faceIndex).toBe(hitB?.faceIndex);
      expect(hitA?.point.toArray()).toEqual(hitB?.point.toArray());
      expect(hitA?.face?.normal.toArray()).toEqual(hitB?.face?.normal.toArray());
      if (hitA) hits += 1;
    }
    expect(hits).toBeGreaterThan(100);
    expect(sent.mesh.indices).toEqual(indicesBefore);
    expect(sent.bvh.indirectBuffer).toBeInstanceOf(Uint32Array);
  });

  it('a full-tier mesh gets no display copy and its own pick index', () => {
    const imported = geometryToMesh(new TorusKnotGeometry(10, 3, 400, 40)); // 32,000 triangles
    const prepared = prepare({ name: 'knot', mesh: imported }, 'web', () => {}, 0, 1, centreInPlace, decimate);
    expect(prepared.display).toBeUndefined();
    expect(prepared.bvh.indirectBuffer.length).toBe(prepared.mesh.indices.length / 3);
  });
});
