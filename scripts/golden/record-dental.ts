import '../test-support/useNodeEngine';
/*
 * ONE-OFF recorder (U9, fork A): ran the TS oracle once and wrote the goldens under scripts/fixtures/golden/.
 * (Region, orientation and legacy-area goldens were recorded by a temporary RECORD_ORACLE branch in the parity tests.)
 * Removed with scripts/test-support/ts-oracle/ (it imports it). To refresh a golden after an intended Rust
 * change use `UPDATE_GOLDENS=1 npx vitest run <test>` instead (see scripts/test-support/golden.ts).
 *   npx vite-node scripts/golden/record-dental.ts
 */
import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { parseStl } from '../test-support/rustImport';
import { seededRays } from '../test-support/knotRays';
import { writeGolden } from '../test-support/golden';

const knotBytes = readFileSync('scripts/fixtures/knot.stl');
const knot = parseStl(new Uint8Array(knotBytes.buffer, knotBytes.byteOffset, knotBytes.byteLength), 'knot');

// random rays: three-mesh-bvh face + distance (-1 for a miss)
{
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(knot.positions, 3));
  geometry.setIndex(new BufferAttribute(knot.indices, 1));
  const bvh = new MeshBVH(geometry, { indirect: true } as ConstructorParameters<typeof MeshBVH>[1]);
  const rays = seededRays(knot);
  const faces: number[] = [];
  const distances: number[] = [];
  for (let k = 0; k < rays.length / 6; k += 1) {
    const r = rays.slice(k * 6, k * 6 + 6);
    const hit = bvh.raycastFirst(new Ray(new Vector3(r[0], r[1], r[2]), new Vector3(r[3], r[4], r[5])), DoubleSide, 0, Infinity);
    faces.push(hit?.faceIndex ?? -1);
    distances.push(hit ? hit.distance : -1);
  }
  writeGolden('knot-random-rays', { faces, distances });
}

// knot vertex normals and dental face overlay (spatialParity)
{
  const { vertexNormals } = await import('../test-support/ts-oracle/placement/vertexNormals');
  const { dentalFaceOverlay, dentalContourSegments } = await import('../test-support/ts-oracle/dentalFaceOverlay');
  const { approxArray } = await import('../test-support/golden');
  const points = Array.from({ length: knot.positions.length / 3 }, (_, v) => [knot.positions[v * 3]!, knot.positions[v * 3 + 1]!, knot.positions[v * 3 + 2]!] as [number, number, number]);
  const faces = Array.from({ length: knot.indices.length / 3 }, (_, f) => [knot.indices[f * 3]!, knot.indices[f * 3 + 1]!, knot.indices[f * 3 + 2]!]);
  writeGolden('knot-vertex-normals', approxArray(vertexNormals(points, faces).flat(), 31));
  const allowed = Uint8Array.from({ length: knot.indices.length / 3 }, (_, f) => (f % 3 === 0 ? 1 : 0));
  const overlay = dentalFaceOverlay(knot, allowed);
  const pairs = Uint32Array.of(0, 5, 7, 9);
  writeGolden('knot-dental-overlay', { positions: approxArray(overlay.positions, 53), normals: approxArray(overlay.normals, 53), segments: Array.from(dentalContourSegments(knot, pairs)) });
}
