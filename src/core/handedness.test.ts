import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from './analysis/types';
import { fromLeftHanded, fromLeftHandedMatrix, fromLeftHandedVector, toLeftHanded, toLeftHandedMatrix, toLeftHandedVector } from './handedness';
import { applyToDirection, applyToPoint, placementMatrix } from '../../scripts/test-support/matrix';
import { cross, dot, normalize, subtract, type Vector } from './vec3';

/** Unit cube [0, 1]³, counter-clockwise outward (the core's winding). */
function cube(): TriangleMesh {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1);
  const indices = Uint32Array.of(
    0, 2, 1, 0, 3, 2, // -z
    4, 5, 6, 4, 6, 7, // +z
    0, 1, 5, 0, 5, 4, // -y
    3, 7, 6, 3, 6, 2, // +y
    0, 4, 7, 0, 7, 3, // -x
    1, 2, 6, 1, 6, 5, // +x
  );
  return { positions, indices };
}

const vertex = (mesh: TriangleMesh, index: number): Vector => [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
const corners = (mesh: TriangleMesh, triangle: number): [Vector, Vector, Vector] => [0, 1, 2].map((k) => vertex(mesh, mesh.indices[triangle * 3 + k]!)) as [Vector, Vector, Vector];
const centroid = (mesh: TriangleMesh, triangle: number): Vector => {
  const [a, b, c] = corners(mesh, triangle);
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
};
/** Right-handed face normal, (b − a) × (c − a): outward for the core's counter-clockwise winding. */
const coreNormal = (mesh: TriangleMesh, triangle: number): Vector => {
  const [a, b, c] = corners(mesh, triangle);
  return normalize(cross(subtract(b, a), subtract(c, a)));
};
/** Babylon's `VertexData.ComputeNormals` in a left-handed scene: (a − b) × (c − b). */
const babylonNormal = (mesh: TriangleMesh, triangle: number): Vector => {
  const [a, b, c] = corners(mesh, triangle);
  return normalize(cross(subtract(a, b), subtract(c, b)));
};
/** Signed volume by the right-handed formula: positive for counter-clockwise outward. */
const signedVolume = (mesh: TriangleMesh): number => {
  let sum = 0;
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const [a, b, c] = corners(mesh, t);
    sum += dot(a, cross(b, c));
  }
  return sum / 6;
};
const closeTo = (actual: readonly number[], expected: readonly number[]) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 12));

describe('core/handedness', () => {
  it('mirrors Z and keeps X, Y and the index order', () => {
    const mesh = cube();
    const left = toLeftHanded(mesh);
    for (let v = 0; v < 8; v++) {
      const [x, y, z] = vertex(mesh, v);
      expect(vertex(left, v)).toEqual([x, y, -z]);
    }
    // Same triangle order, so a Babylon pick's faceId is the core's triangle index.
    expect(left.indices).toBe(mesh.indices);
    expect(left.positions).not.toBe(mesh.positions);
    expect(mesh.positions[14]).toBe(1); // the input is never changed
  });

  it('round-trips to the identical mesh, bit for bit (signed zeros too)', () => {
    const mesh = { positions: Float32Array.of(0, -0, 0, 1.5, -2.25, 1e-30, -7, 3, -0), indices: Uint32Array.of(0, 1, 2) };
    const back = fromLeftHanded(toLeftHanded(mesh));
    expect(new Uint8Array(back.positions.buffer)).toEqual(new Uint8Array(mesh.positions.buffer));
    expect(back.indices).toBe(mesh.indices);
    expect(toLeftHanded(fromLeftHanded(mesh)).positions).toEqual(mesh.positions);
  });

  it('keeps the other fields of a support mesh (parts, components)', () => {
    const mesh = { ...cube(), parts: ['tip'], components: [{ part: 'tip', contactId: 'a', start: 0, count: 36 }] };
    const left = toLeftHanded(mesh);
    expect(left.parts).toBe(mesh.parts);
    expect(left.components).toBe(mesh.components);
  });

  it('gives outward normals under Babylon left-handed winding (no index swap needed)', () => {
    const mesh = cube();
    const left = toLeftHanded(mesh);
    const centre: Vector = [0.5, 0.5, -0.5];
    for (let t = 0; t < 12; t++) {
      const normal = babylonNormal(left, t);
      // Points away from the mirrored cube's centre ...
      expect(dot(normal, subtract(centroid(left, t), centre))).toBeGreaterThan(0);
      // ... and is the core's outward normal mirrored like a vector.
      closeTo(normal, toLeftHandedVector(coreNormal(mesh, t)));
    }
    // The mirror flips the winding by itself: positive (counter-clockwise outward) becomes
    // negative, which is what a Babylon mesh with the default CounterClockWise side orientation
    // has (mixomesh PrintSpace.signedVolume). Swapping two indices as well would turn it inside out.
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
    expect(signedVolume(left)).toBeCloseTo(-1, 6);
    const swapped = { positions: left.positions, indices: left.indices.map((_, i, all) => all[i - (i % 3) + [0, 2, 1][i % 3]!]!) };
    expect(dot(babylonNormal(swapped, 0), subtract(centroid(swapped, 0), centre))).toBeLessThan(0);
  });

  it('mirrors points and normals the same way, both directions', () => {
    expect(toLeftHandedVector([1, 2, 3])).toEqual([1, 2, -3]);
    expect(fromLeftHandedVector([1, 2, -3])).toEqual([1, 2, 3]);
    const normal = normalize([0.3, -0.4, 0.5]);
    expect(fromLeftHandedVector(toLeftHandedVector(normal))).toEqual(normal);
  });

  it('converts placement matrices as S · M · S, so mirrored points stay consistent', () => {
    const m = placementMatrix({ position: [4, -5, 6], rotation: [0.3, -1.1, 2.4] });
    const left = toLeftHandedMatrix(m);
    const p: Vector = [1.25, -2, 3.5];
    // Placing then mirroring equals mirroring then placing with the converted matrix.
    closeTo(applyToPoint(left, ...toLeftHandedVector(p)), toLeftHandedVector(applyToPoint(m, ...p)));
    closeTo(applyToDirection(left, ...toLeftHandedVector(p)), toLeftHandedVector(applyToDirection(m, ...p)));
    expect(Array.from(fromLeftHandedMatrix(left))).toEqual(Array.from(m));
    expect(m[12]).toBe(4); // the input is never changed
  });
});
