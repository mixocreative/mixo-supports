/**
 * Recorded camera + pointer fixture for the Rust pick / screen-brush parity tests (U2).
 * The TS oracle (three.js camera + three-mesh-bvh + src/editing/screenBrush.ts) answers; the
 * answers are committed in aligner-brush.json. Regenerate only when a case is added:
 *   npx vite-node scripts/fixtures/brush/write.ts
 * src/workers/spatialParity.test.ts fails if the committed file differs from what this makes.
 *
 * Bodies are synthetic pillars hanging 6 mm below random aligner triangles (two segments each),
 * so from above many are hidden behind the model and from below most are visible.
 */
import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, FrontSide, Matrix4, PerspectiveCamera, Ray, Raycaster, Vector2, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { TriangleMesh } from '../../../src/core/analysis/types';
import type { Vector } from '../../../src/core/vec3';
import { placementMatrix } from '../../../src/core/transform';
import { brushHitsFrom, cachedVisibility, hiddenByModel, projectBodies, type BodySegments } from '../../test-support/ts-oracle/screenBrush';
import { parseStl } from '../../test-support/rustImport';

export const ALIGNER = 'docs/dental-reference/reference-aligner.stl';
export const WIDTH = 800;
export const HEIGHT = 500;

export interface BrushCase {
  name: string;
  /** Model world matrix (the model's local frame is the mesh's own). */
  modelWorld: number[];
  /** Support group world matrix (same as the model for a real unit; offset in the last case). */
  supportWorld: number[];
  /** projection * view * supportWorld: support-local to clip. */
  clip: number[];
  /** inverse(projection * view * modelWorld): clip to model-local, for pixel picks. */
  clipToModel: number[];
  /** inverse(modelWorld) * supportWorld. */
  supportToModel: number[];
  /** Camera position in support-local space. */
  eye: number[];
  pixels: number[];
  /** Face id of the first model hit under each pixel, -1 for none (three.js camera ray + MeshBVH). */
  pickFaces: number[];
  strokes: { radius: number; points: number[]; slots: number[]; /** touched by the circle but hidden behind the model */ hiddenSlots: number[] }[];
}

export interface BrushFixture {
  aligner: string;
  triangles: number;
  width: number;
  height: number;
  bodies: { points: number[]; first: number[] };
  cases: BrushCase[];
}

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBodies(mesh: TriangleMesh, count: number, rnd: () => number): BodySegments {
  const faces = mesh.indices.length / 3;
  const ids: string[] = [];
  const first = new Uint32Array(count + 1);
  const points = new Float32Array(count * 2 * 6);
  for (let k = 0; k < count; k++) {
    const face = Math.floor(rnd() * faces);
    const c = [0, 0, 0];
    for (let corner = 0; corner < 3; corner++) for (let axis = 0; axis < 3; axis++) c[axis]! += mesh.positions[mesh.indices[face * 3 + corner]! * 3 + axis]! / 3;
    ids.push(`c${k}`);
    first[k] = k * 2;
    points.set([c[0]!, c[1]!, c[2]!, c[0]!, c[1]! - 3, c[2]!, c[0]!, c[1]! - 3, c[2]!, c[0]!, c[1]! - 6, c[2]!], k * 12);
  }
  first[count] = count * 2;
  return { ids, first, points };
}

function bounds(mesh: TriangleMesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a]!, mesh.positions[i + a]!);
    max[a] = Math.max(max[a]!, mesh.positions[i + a]!);
  }
  return { center: min.map((v, a) => (v + max[a]!) / 2), size: Math.max(...max.map((v, a) => v - min[a]!)) };
}

const toMatrix = (elements: ArrayLike<number>) => new Matrix4().fromArray(Array.from(elements));

export function buildBrushFixture(): BrushFixture {
  const bytes = readFileSync(ALIGNER);
  const mesh = parseStl(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'aligner');
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const bvh = new MeshBVH(geometry, { indirect: true } as ConstructorParameters<typeof MeshBVH>[1]);
  const { center, size } = bounds(mesh);
  const rnd = random(20261027);
  const bodies = makeBodies(mesh, 48, rnd);

  // [azimuth, elevation (rad), distance in model sizes, model placement, support offset x]
  const views: [string, number, number, number, { position: [number, number, number]; rotation: [number, number, number] }, number][] = [
    ['from above', 0.3, 1.2, 1.8, { position: [0, 0, 0], rotation: [0, 0, 0] }, 0],
    ['from below', 1.9, -1.0, 1.6, { position: [5, 2, -3], rotation: [0.2, 0.5, 0.1] }, 0],
    ['side, support offset', 3.6, 0.1, 2.0, { position: [-4, 0, 6], rotation: [0, -0.8, 0] }, 2],
  ];
  const cases: BrushCase[] = views.map(([name, azimuth, elevation, distance, placement, offset]) => {
    const modelWorld = toMatrix(placementMatrix({ position: placement.position, rotation: placement.rotation }));
    const supportWorld = toMatrix(placementMatrix({ position: [placement.position[0] + offset, placement.position[1], placement.position[2]], rotation: placement.rotation }));
    const target = new Vector3(...(center as [number, number, number])).applyMatrix4(modelWorld);
    const camera = new PerspectiveCamera(40, WIDTH / HEIGHT, 1, 4000);
    camera.position.set(
      target.x + Math.cos(elevation) * Math.sin(azimuth) * size * distance,
      target.y + Math.sin(elevation) * size * distance,
      target.z + Math.cos(elevation) * Math.cos(azimuth) * size * distance,
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const clip = viewProjection.clone().multiply(supportWorld);
    const modelInverse = modelWorld.clone().invert();
    const clipToModel = viewProjection.clone().multiply(modelWorld).invert();
    const supportToModel = modelInverse.clone().multiply(supportWorld);
    const eye = camera.position.clone().applyMatrix4(supportWorld.clone().invert());

    // Pixel picks: THREE camera ray into model-local space, first hit by MeshBVH (material side Front).
    const raycaster = new Raycaster();
    const pixels: number[] = [];
    const pickFaces: number[] = [];
    const focus = target.clone().applyMatrix4(viewProjection);
    const [fx, fy] = [(focus.x + 1) * 0.5 * WIDTH, (1 - focus.y) * 0.5 * HEIGHT];
    for (let k = 0; k < 60; k++) {
      const x = Math.round(Math.min(WIDTH - 1, Math.max(0, fx + (rnd() - 0.5) * 320)) * 8) / 8;
      const y = Math.round(Math.min(HEIGHT - 1, Math.max(0, fy + (rnd() - 0.5) * 200)) * 8) / 8;
      pixels.push(x, y);
      raycaster.setFromCamera(new Vector2((x / WIDTH) * 2 - 1, 1 - (y / HEIGHT) * 2), camera);
      const ray = new Ray(raycaster.ray.origin.clone().applyMatrix4(modelInverse), raycaster.ray.direction.clone().transformDirection(modelInverse));
      pickFaces.push(bvh.raycastFirst(ray, FrontSide, 0, Infinity)?.faceIndex ?? -1);
    }

    // Brush: the oracle's projection, ray visibility with the same cache, and hit loop.
    const projected = projectBodies(bodies, clip.elements, WIDTH, HEIGHT);
    const world = new Vector3();
    const direction = new Vector3();
    const ray = new Ray();
    const rayVisible = (point: Vector) => {
      world.set(point[0]!, point[1]!, point[2]!).applyMatrix4(supportWorld);
      direction.subVectors(world, camera.position);
      const dist = direction.length();
      direction.divideScalar(dist);
      ray.origin.copy(camera.position).applyMatrix4(modelInverse);
      ray.direction.copy(direction).transformDirection(modelInverse);
      const hit = bvh.raycastFirst(ray, FrontSide, 0, dist);
      return !hiddenByModel(dist, hit?.distance);
    };
    const mid = (slot: number) => {
      const p = bodies.points;
      const o = bodies.first[slot]! * 6;
      return [(p[o]! + p[o + 9]!) / 2, (p[o + 1]! + p[o + 10]!) / 2, (p[o + 2]! + p[o + 11]!) / 2] as const;
    };
    const strokes: BrushCase['strokes'][number][] = [];
    const aim = Array.from({ length: bodies.ids.length }, (_, slot) => {
      const m = mid(slot);
      const v = new Vector3(...m).applyMatrix4(clip);
      return [(v.x + 1) * 0.5 * WIDTH, (1 - v.y) * 0.5 * HEIGHT, v.z] as const;
    }).filter(([x, y, z]) => x > 40 && x < WIDTH - 40 && y > 40 && y < HEIGHT - 40 && z > -1 && z < 1);
    for (let s = 0; s < 6 && aim.length > 0; s++) {
      const [ax, ay] = aim[Math.floor(rnd() * aim.length)]!;
      const radius = 12 + Math.round(rnd() * 12);
      const points: number[] = [];
      for (let k = 0; k < 7; k++) points.push(Math.round((ax + (k - 3) * 9 + rnd() * 6) * 8) / 8, Math.round((ay + (k - 3) * 5 + rnd() * 6) * 8) / 8);
      const run = (isVisible: (p: Vector, segment: number, t: number) => boolean) => {
        const seen = new Set<string>();
        let previous: [number, number] | undefined;
        for (let k = 0; k < points.length; k += 2) {
          const to: [number, number] = [points[k]!, points[k + 1]!];
          for (const id of brushHitsFrom(0, bodies, projected, previous, to, radius, isVisible).hits) seen.add(id);
          previous = to;
        }
        return seen;
      };
      const visible = run(cachedVisibility(rayVisible).isVisible);
      const touched = run(() => true);
      const slotOf = (id: string) => bodies.ids.indexOf(id);
      strokes.push({
        radius,
        points,
        slots: [...visible].map(slotOf).sort((a, b) => a - b),
        hiddenSlots: [...touched].filter((id) => !visible.has(id)).map(slotOf).sort((a, b) => a - b),
      });
    }
    return {
      name,
      modelWorld: Array.from(modelWorld.elements),
      supportWorld: Array.from(supportWorld.elements),
      clip: Array.from(clip.elements),
      clipToModel: Array.from(clipToModel.elements),
      supportToModel: Array.from(supportToModel.elements),
      eye: eye.toArray(),
      pixels,
      pickFaces,
      strokes,
    };
  });
  return {
    aligner: ALIGNER,
    triangles: mesh.indices.length / 3,
    width: WIDTH,
    height: HEIGHT,
    bodies: { points: Array.from(bodies.points), first: Array.from(bodies.first) },
    cases,
  };
}
