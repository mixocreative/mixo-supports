import type { TriangleMesh } from '../../../src/core/analysis/types';

/**
 * Vertex welding on typed arrays, output-identical to three.js `mergeVertices(geometry, 1e-4)` on a
 * position-only geometry (same quantised keys, same first-seen vertex order, same index buffer),
 * without its per-vertex string keys: an open-addressing hash table of vertex numbers over the
 * output positions, whose keys are recomputed from the stored float32 values.
 */

/** Same arithmetic as mergeVertices, so the quantised keys match it exactly. */
function quantiser(tolerance: number) {
  const safe = Math.max(tolerance, Number.EPSILON);
  const halfTolerance = safe * 0.5;
  const exponent = Math.log10(1 / safe);
  const multiplier = Math.pow(10, exponent);
  return { multiplier, additive: halfTolerance * multiplier };
}

/** Column-major 4x4 matrix applied the way three's `Vector3.applyMatrix4` does, then rounded to float32. */
export function transformInto(e: ArrayLike<number>, x: number, y: number, z: number, out: Float32Array, offset: number): void {
  const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
  out[offset] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w;
  out[offset + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w;
  out[offset + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w;
}

/** Three's `makeRotationX(-PI / 2)`: STL Z-up to the editor's Y-up, web (x, y, z) = STL (x, z, -y). */
export const Z_UP_TO_Y_UP: readonly number[] = (() => {
  const c = Math.cos(-Math.PI / 2);
  const s = Math.sin(-Math.PI / 2);
  // Column-major, as Matrix4.set(1,0,0,0, 0,c,-s,0, 0,s,c,0, 0,0,0,1) stores it.
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
})();

/**
 * Adds vertices one at a time and hands back the index of the welded vertex. `expectedVertices`
 * only sizes the first allocation; the arrays grow as needed.
 */
export class VertexWelder {
  private positions: Float32Array;
  private table: Int32Array;
  private mask: number;
  count = 0;
  private readonly multiplier: number;
  private readonly additive: number;

  constructor(expectedVertices: number, tolerance = 1e-4) {
    ({ multiplier: this.multiplier, additive: this.additive } = quantiser(tolerance));
    const capacity = Math.max(16, Math.ceil(expectedVertices));
    this.positions = new Float32Array(capacity * 3);
    const slots = nextPowerOfTwo(capacity * 2);
    this.table = new Int32Array(slots).fill(-1);
    this.mask = slots - 1;
  }

  /** The welded vertex for a float32 point (values already rounded to float32). */
  add(x: number, y: number, z: number): number {
    const m = this.multiplier;
    const a = this.additive;
    // `~~` truncates to int32 exactly like mergeVertices' hash.
    const kx = ~~(x * m + a);
    const ky = ~~(y * m + a);
    const kz = ~~(z * m + a);
    const positions = this.positions;
    let slot = hash(kx, ky, kz) & this.mask;
    for (;;) {
      const vertex = this.table[slot]!;
      if (vertex < 0) break;
      const o = vertex * 3;
      if (~~(positions[o]! * m + a) === kx && ~~(positions[o + 1]! * m + a) === ky && ~~(positions[o + 2]! * m + a) === kz) return vertex;
      slot = (slot + 1) & this.mask;
    }
    const vertex = this.count++;
    if (vertex * 3 + 3 > positions.length) this.growPositions();
    const o = vertex * 3;
    this.positions[o] = x;
    this.positions[o + 1] = y;
    this.positions[o + 2] = z;
    this.table[slot] = vertex;
    if (this.count * 2 > this.table.length) this.growTable();
    return vertex;
  }

  /** The welded positions, trimmed to the vertices added. */
  finish(): Float32Array {
    const out = this.positions.length === this.count * 3 ? this.positions : this.positions.slice(0, this.count * 3);
    this.positions = new Float32Array(0);
    this.table = new Int32Array(0);
    return out;
  }

  private growPositions(): void {
    const grown = new Float32Array(Math.max(48, Math.ceil(this.positions.length * 1.5 / 3) * 3));
    grown.set(this.positions);
    this.positions = grown;
  }

  private growTable(): void {
    const slots = this.table.length * 2;
    const table = new Int32Array(slots).fill(-1);
    const mask = slots - 1;
    const m = this.multiplier;
    const a = this.additive;
    for (let vertex = 0; vertex < this.count; vertex += 1) {
      const o = vertex * 3;
      let slot = hash(~~(this.positions[o]! * m + a), ~~(this.positions[o + 1]! * m + a), ~~(this.positions[o + 2]! * m + a)) & mask;
      while (table[slot]! >= 0) slot = (slot + 1) & mask;
      table[slot] = vertex;
    }
    this.table = table;
    this.mask = mask;
  }
}

function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d);
  h ^= h >>> 15;
  return Math.imul(h, 0x2c1b3c6d) >>> 0;
}

function nextPowerOfTwo(n: number): number {
  let p = 16;
  while (p < n) p *= 2;
  return p;
}

/**
 * Welds a position array (optionally indexed) into an indexed mesh. With `matrix` (column-major)
 * the positions are first transformed **in place**, as three's `applyMatrix4` would, so pass an
 * array the caller owns. Throws `NonFiniteError` when a coordinate is NaN or infinite.
 */
export function weldPositions(positions: Float32Array, indices?: ArrayLike<number>, matrix?: ArrayLike<number>): TriangleMesh {
  const vertexCount = positions.length / 3;
  const source = positions;
  if (matrix) for (let o = 0; o < positions.length; o += 3) transformInto(matrix, positions[o]!, positions[o + 1]!, positions[o + 2]!, positions, o);
  assertFinitePositions(source);
  const corners = indices ? indices.length : vertexCount;
  const welder = new VertexWelder(Math.min(vertexCount, Math.ceil(corners / 2)));
  const out = new Uint32Array(corners);
  for (let i = 0; i < corners; i += 1) {
    const o = (indices ? indices[i]! : i) * 3;
    out[i] = welder.add(source[o]!, source[o + 1]!, source[o + 2]!);
  }
  return { positions: welder.finish(), indices: out };
}

/** A coordinate is NaN or infinite (welding would quietly merge such a vertex into another). */
export class NonFiniteError extends Error {
  readonly code = 'non-finite';
  constructor() {
    super('vertex coordinates are not finite numbers (NaN or infinity)');
  }
}

export function assertFinitePositions(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 1) if (!Number.isFinite(positions[i]!)) throw new NonFiniteError();
}
