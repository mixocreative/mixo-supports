import type { TriangleMesh } from './analysis/types';
import type { Matrix4 } from './transform';
import type { Vector } from './vec3';

/**
 * Conversion between the core's right-handed frame (conventions.ts) and a left-handed Y-up host
 * such as Babylon.js with its default `scene.useRightHandedSystem = false`: mirror Z, once, at
 * the host boundary. A host that sets `useRightHandedSystem = true` needs none of this.
 *
 * The mirror reverses the triangle winding on its own, so indices stay as they are: a mirrored
 * counter-clockwise-outward mesh is exactly what Babylon draws front-facing with its default
 * side orientation in a left-handed scene (CounterClockWise), and `VertexData.ComputeNormals`,
 * (a − b) × (c − b), gives it outward normals. Swapping two indices as well would turn it inside
 * out. Keeping the triangle order also keeps a pick's `faceId` equal to the core's triangle index
 * (`contactAtTriangle`). Every conversion is its own inverse and exact (sign flips only).
 */

/** A mesh mirrored into the left-handed frame. Indices and any other fields are shared, never copied or changed. */
export function toLeftHanded<M extends TriangleMesh>(mesh: M): M {
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = mesh.positions[i]!;
    positions[i + 1] = mesh.positions[i + 1]!;
    positions[i + 2] = -mesh.positions[i + 2]!;
  }
  return { ...mesh, positions };
}

/** A left-handed host mesh back in the core's right-handed frame (the same mirror). */
export function fromLeftHanded<M extends TriangleMesh>(mesh: M): M {
  return toLeftHanded(mesh);
}

/** A point or direction (normals included) mirrored into the left-handed frame. */
export function toLeftHandedVector([x, y, z]: readonly [number, number, number]): Vector {
  return [x, y, -z];
}

/** A host point or direction (a picked point, its surface normal) back in the core's frame. */
export function fromLeftHandedVector(vector: readonly [number, number, number]): Vector {
  return toLeftHandedVector(vector);
}

/**
 * A placement matrix (`placementMatrix`, column-major) in the left-handed frame: `S · M · S`,
 * S = diag(1, 1, −1, 1), which negates the elements in exactly one of row 2 and column 2.
 */
export function toLeftHandedMatrix(matrix: Matrix4): Matrix4 {
  const out = Float64Array.from(matrix);
  for (const index of [2, 6, 14, 8, 9, 11]) out[index] = -out[index]!;
  return out;
}

/** A left-handed host matrix back in the core's frame (the same conjugation). */
export function fromLeftHandedMatrix(matrix: Matrix4): Matrix4 {
  return toLeftHandedMatrix(matrix);
}
