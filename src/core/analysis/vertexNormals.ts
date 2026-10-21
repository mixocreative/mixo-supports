import { acosf } from '../acosf';

type Vector = [number, number, number];

const f = Math.fround;
/** Squared lengths at or below this normalise to zero. */
const TINY = 1e-35;

/**
 * Angle-weighted vertex normals in single precision (Blender's "true normals" up to the corner
 * angle: Blender uses a polynomial arccos approximation, the web a correctly rounded-ish
 * `acosf`): Newell face normals; each vertex sums, over its faces in face order, the face
 * normal times the corner angle. A vertex in no face takes its own position direction.
 * Positions are Blender axes (X, Y, Z).
 */
export function vertexNormals(positions: readonly Vector[], faces: readonly (readonly number[])[]): Vector[] {
  const sums: Vector[] = positions.map(() => [0, 0, 0]);
  const used = new Uint8Array(positions.length);
  for (const face of faces) {
    const normal = faceNormal(positions, face);
    const n = face.length;
    for (let corner = 0; corner < n; corner += 1) {
      const vertex = face[corner]!;
      const here = positions[vertex]!;
      const toPrev = divideByLength(difference(positions[face[(corner + n - 1) % n]!]!, here));
      const toNext = divideByLength(difference(positions[face[(corner + 1) % n]!]!, here));
      const weight = acosf(dot(toPrev, toNext));
      const sum = sums[vertex]!;
      for (let axis = 0; axis < 3; axis += 1) sum[axis] = f(sum[axis]! + f(normal[axis]! * weight));
      used[vertex] = 1;
    }
  }
  return sums.map((sum, vertex) => divideByLength(used[vertex] ? sum : positions[vertex]!));
}

/** Newell's method from the closing edge (last corner to first); +Z when degenerate. */
export function faceNormal(positions: readonly Vector[], face: readonly number[]): Vector {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let a = positions[face[face.length - 1]!]!;
  for (const vertex of face) {
    const b = positions[vertex]!;
    nx = f(nx + f(f(a[1] - b[1]) * f(a[2] + b[2])));
    ny = f(ny + f(f(a[2] - b[2]) * f(a[0] + b[0])));
    nz = f(nz + f(f(a[0] - b[0]) * f(a[1] + b[1])));
    a = b;
  }
  const lengthSq = dot([nx, ny, nz], [nx, ny, nz]);
  if (!(lengthSq > TINY)) return [0, 0, 1];
  const inverse = f(1 / f(Math.sqrt(lengthSq)));
  return [f(nx * inverse), f(ny * inverse), f(nz * inverse)];
}

function difference(a: Vector, b: Vector): Vector {
  return [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
}

function dot(a: Vector, b: Vector): number {
  return f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
}

/** Unit vector by division by the length; zero when (nearly) zero. */
function divideByLength(v: Vector): Vector {
  const lengthSq = dot(v, v);
  if (!(lengthSq > TINY)) return [0, 0, 0];
  const length = f(Math.sqrt(lengthSq));
  return [f(v[0] / length), f(v[1] / length), f(v[2] / length)];
}
