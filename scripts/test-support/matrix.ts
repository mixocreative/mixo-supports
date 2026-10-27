import type { Matrix4, Placement } from '../../src/core/transform';
import type { Vector } from '../../src/core/vec3';

/*
 * Test-only TypeScript reference for the placement matrix maths (three.js r173 arithmetic, operation for
 * operation). Production runs the Rust `placement_matrix` / `invert_matrix` / `transform_positions` through
 * `src/state/transform`; tests use this to build poses and as the reference the Rust calls are checked against.
 */

/** Rotation quaternion `[x, y, z, w]` of Euler XYZ angles (radians). */
export function quaternionFromEuler([x, y, z]: Vector): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

// The arithmetic below follows three.js r173 (Quaternion.setFromEuler, Matrix4.compose / invert,
// Vector3.applyMatrix4 / transformDirection) operation for operation, so results match the
// three.js code they replaced bit for bit.

/** Placement matrix (unit scale): object-local point → parent (plate) space. */
export function placementMatrix(placement: Placement): Matrix4 {
  const [x, y, z, w] = quaternionFromEuler(placement.rotation);
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [px, py, pz] = placement.position;
  return Float64Array.of(
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    px, py, pz, 1,
  );
}

/** General 4×4 inverse (all zeros when singular, as three.js does). */
export function invertMatrix(te: Matrix4): Matrix4 {
  const n11 = te[0]!, n21 = te[1]!, n31 = te[2]!, n41 = te[3]!;
  const n12 = te[4]!, n22 = te[5]!, n32 = te[6]!, n42 = te[7]!;
  const n13 = te[8]!, n23 = te[9]!, n33 = te[10]!, n43 = te[11]!;
  const n14 = te[12]!, n24 = te[13]!, n34 = te[14]!, n44 = te[15]!;
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (det === 0) return new Float64Array(16);
  const detInv = 1 / det;
  return Float64Array.of(
    t11 * detInv,
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv,
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv,
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv,
    t12 * detInv,
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv,
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv,
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv,
    t13 * detInv,
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv,
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv,
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv,
    t14 * detInv,
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv,
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv,
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv,
  );
}

/** A point through a matrix, with the projective divide. */
export function applyToPoint(e: Matrix4, x: number, y: number, z: number): Vector {
  const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
  return [
    (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w,
    (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w,
    (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w,
  ];
}

/** A direction through a matrix's linear part, normalised (a zero vector stays zero). Rigid matrices only (no scale). */
export function applyToDirection(e: Matrix4, x: number, y: number, z: number): Vector {
  const dx = e[0]! * x + e[4]! * y + e[8]! * z;
  const dy = e[1]! * x + e[5]! * y + e[9]! * z;
  const dz = e[2]! * x + e[6]! * y + e[10]! * z;
  const scale = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
  return [dx * scale, dy * scale, dz * scale];
}

/** Every xyz triple of `positions` through `matrix`, into a new Float32Array. */
export function transformPositions(positions: Float32Array, matrix: Matrix4): Float32Array {
  const out = new Float32Array(positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    const [x, y, z] = applyToPoint(matrix, positions[offset]!, positions[offset + 1]!, positions[offset + 2]!);
    out[offset] = x;
    out[offset + 1] = y;
    out[offset + 2] = z;
  }
  return out;
}
