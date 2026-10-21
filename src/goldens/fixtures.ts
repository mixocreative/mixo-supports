import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { TriangleMesh } from '../analysis/types';
import { importStlUnit } from '../state/import';

type Vector = [number, number, number];

/** A golden model: unit-local mesh (as import produces it) and the rotation the unit is given. */
export interface GoldenFixture {
  name: string;
  mesh: TriangleMesh;
  rotation: Vector;
}

/**
 * A 10 mm cube with a 6 mm shelf cantilevered off one side (the cube of the unit tests plus an
 * overhang): an L profile in x/y extruded 10 mm along z. Both undersides need support.
 */
function cubeWithOverhang(): TriangleMesh {
  const profile: [number, number][] = [[0, 0], [10, 0], [10, 6], [16, 6], [16, 10], [10, 10], [0, 10]];
  // Counter-clockwise seen from +z; the cube part is a fan from (0, 0), the shelf a quad.
  const cap: [number, number, number][] = [[0, 1, 2], [0, 2, 5], [0, 5, 6], [2, 3, 4], [2, 4, 5]];
  const n = profile.length;
  const positions: number[] = [];
  for (const z of [-5, 5]) for (const [x, y] of profile) positions.push(x, y, z);
  const indices: number[] = [];
  for (const [a, b, c] of cap) {
    indices.push(n + a, n + b, n + c); // front (z = 5) faces +z
    indices.push(a, c, b); // back (z = -5) faces -z
  }
  for (let k = 0; k < n; k += 1) {
    const next = (k + 1) % n;
    indices.push(k, next, n + next, k, n + next, n + k);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** A 24 x 1 x 12 mm plate tilted 30 degrees about z: a thin wall whose underside overhangs. */
function thinWallSlab(): TriangleMesh {
  const [sx, sy, sz] = [12, 0.5, 6];
  const angle = Math.PI / 6;
  const corners: Vector[] = [];
  for (const y of [-sy, sy]) for (const [x, z] of [[-sx, -sz], [sx, -sz], [sx, sz], [-sx, sz]] as const) {
    corners.push([round6(x * Math.cos(angle) - y * Math.sin(angle)), round6(x * Math.sin(angle) + y * Math.cos(angle)), z]);
  }
  // Same corner order and winding as the unit-test cube: bottom 0-3, top 4-7.
  const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  return { positions: new Float32Array(corners.flat()), indices: new Uint32Array(indices) };
}

/**
 * A (2, 3) torus knot tube, 30 mm across with a 5 mm tube, in place of `.playwright-mcp/knot.stl`
 * (3.8 MB, too big for the repo). Fixed parameters make it deterministic; it is written as a binary
 * STL triangle soup and read back through the app's STL import (Z-up to Y-up, vertex welding).
 */
function torusKnot(): TriangleMesh {
  const [p, q, scale, tube, tubular, radial] = [2, 3, 5, 2.5, 96, 10];
  const curve = (t: number): Vector => {
    const r = 2 + Math.cos(q * t);
    return [scale * r * Math.cos(p * t), scale * r * Math.sin(p * t), scale * Math.sin(q * t)];
  };
  const ring: Vector[][] = [];
  for (let i = 0; i < tubular; i += 1) {
    const t = (i / tubular) * 2 * Math.PI;
    const centre = curve(t);
    const ahead = curve(t + 0.01);
    const tangent = normalize(sub(ahead, centre));
    const binormal = normalize(cross(tangent, add(ahead, centre)));
    const normal = cross(binormal, tangent);
    ring.push(Array.from({ length: radial }, (_, j) => {
      const v = (j / radial) * 2 * Math.PI;
      const offset = add(scaleBy(normal, tube * Math.cos(v)), scaleBy(binormal, tube * Math.sin(v)));
      return add(centre, offset).map(round6) as Vector;
    }));
  }
  const triangles: [Vector, Vector, Vector][] = [];
  for (let i = 0; i < tubular; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = ring[i]![j]!;
      const b = ring[(i + 1) % tubular]![j]!;
      const c = ring[(i + 1) % tubular]![(j + 1) % radial]!;
      const d = ring[i]![(j + 1) % radial]!;
      triangles.push([a, d, b], [b, d, c]);
    }
  }
  // Wind outward (positive volume) whatever the frame's handedness came out as.
  const volume = triangles.reduce((sum, [a, b, c]) => sum + dot(a, cross(b, c)), 0);
  const soup = volume > 0 ? triangles : triangles.map(([a, b, c]) => [a, c, b] as [Vector, Vector, Vector]);
  return importStlUnit(new STLLoader().parse(binaryStl(soup)), 'knot.stl').mesh;
}

/** Binary STL of a triangle soup (normals left zero; STLLoader recomputes nothing from them). */
function binaryStl(triangles: readonly [Vector, Vector, Vector][]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const triangle of triangles) {
    offset += 12;
    for (const vertex of triangle) {
      for (const value of vertex) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    offset += 2;
  }
  return buffer;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6 + 0;
}
function add(a: Vector, b: Vector): Vector {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: Vector, b: Vector): Vector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scaleBy(a: Vector, s: number): Vector {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vector, b: Vector): Vector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a: Vector): Vector {
  return scaleBy(a, 1 / Math.hypot(...a));
}

export const GOLDEN_FIXTURES: readonly GoldenFixture[] = [
  { name: 'cube-overhang', mesh: cubeWithOverhang(), rotation: [0, 0, 0] },
  // Tilted on two axes so placement, support and check run through the unit transform.
  { name: 'knot', mesh: torusKnot(), rotation: [0.4, 0, 0.25] },
  { name: 'thin-slab', mesh: thinWallSlab(), rotation: [0, 0, 0] },
];
