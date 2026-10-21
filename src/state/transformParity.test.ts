import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../core/analysis/types';
import type { Vector } from '../core/vec3';
import { applyTransform, inverseTransformDirection, inverseTransformMesh, inverseTransformPoint, transformDirection, transformPoint, type ModelTransform } from './transform';

// The three.js code state/transform.ts used before core/transform.ts replaced it, kept as the
// reference: the replacement must give the same numbers (to 1e-9; in practice bit for bit).
function threeMatrix(transform: ModelTransform): Matrix4 {
  return new Matrix4().compose(new Vector3(...transform.position), new Quaternion().setFromEuler(new Euler(...transform.rotation)), new Vector3(1, 1, 1));
}
const reference = {
  point: (t: ModelTransform, p: Vector) => new Vector3(...p).applyMatrix4(threeMatrix(t)).toArray(),
  inversePoint: (t: ModelTransform, p: Vector) => new Vector3(...p).applyMatrix4(threeMatrix(t).invert()).toArray(),
  direction: (t: ModelTransform, d: Vector) => new Vector3(...d).transformDirection(threeMatrix(t)).toArray(),
  inverseDirection: (t: ModelTransform, d: Vector) => new Vector3(...d).transformDirection(threeMatrix(t).invert()).toArray(),
  mesh(positions: Float32Array, t: ModelTransform, invert: boolean) {
    const matrix = invert ? threeMatrix(t).invert() : threeMatrix(t);
    const out = new Float32Array(positions.length);
    const point = new Vector3();
    for (let offset = 0; offset < positions.length; offset += 3) point.fromArray(positions, offset).applyMatrix4(matrix).toArray(out, offset);
    return out;
  },
};

/** Small deterministic generator (mulberry32). */
function random(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const next = random(7_2026_10_21);
const vector = (scale: number): Vector => [(next() - 0.5) * scale, (next() - 0.5) * scale, (next() - 0.5) * scale];
/** 50 transforms: random, plus exact right angles, zero rotation and gimbal lock (y = ±π/2). */
const TRANSFORMS: ModelTransform[] = Array.from({ length: 50 }, (_, index) => {
  const position = vector(400);
  if (index === 0) return { position, rotation: [0, 0, 0] };
  if (index === 1) return { position, rotation: [Math.PI / 2, Math.PI, -Math.PI / 2] };
  if (index === 2) return { position, rotation: [0.3, Math.PI / 2, -1.1] };
  if (index === 3) return { position, rotation: [-2, -Math.PI / 2, 0.4] };
  return { position, rotation: vector(4 * Math.PI) };
});
const mesh: TriangleMesh = { positions: new Float32Array(Array.from({ length: 300 }, () => (next() - 0.5) * 120)), indices: new Uint32Array([0, 1, 2]) };

function close(actual: ArrayLike<number>, expected: ArrayLike<number>) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(1e-9);
}

describe('state/transform matches the three.js transforms', () => {
  it.each(TRANSFORMS.map((transform, index) => [index, transform] as const))('transform %i', (_, transform) => {
    const point = vector(200);
    const direction = vector(2);
    close(transformPoint(transform, point), reference.point(transform, point));
    close(inverseTransformPoint(transform, point), reference.inversePoint(transform, point));
    close(transformDirection(transform, direction), reference.direction(transform, direction));
    close(inverseTransformDirection(transform, direction), reference.inverseDirection(transform, direction));
    close(applyTransform(mesh, transform).positions, reference.mesh(mesh.positions, transform, false));
    close(inverseTransformMesh(mesh, transform).positions, reference.mesh(mesh.positions, transform, true));
    // Bit for bit, in fact.
    expect(transformPoint(transform, point)).toEqual(reference.point(transform, point));
    expect(Array.from(applyTransform(mesh, transform).positions)).toEqual(Array.from(reference.mesh(mesh.positions, transform, false)));
  });
});
