import type { TriangleMesh } from '../../../../src/core/analysis/types';

type Point2 = [number, number];

/**
 * SLASG_Raft perimeter. Blender flattens the model, builds a narrow-band SDF with voxel size
 * (3D bbox diagonal + 2 Expand) / Voxel Resolution, offsets it by Expand and meshes it at
 * iso 0.1 (OpenVDB dual contouring, adaptivity 0). The boundary of the up-facing faces is the
 * ring of dual vertices in the voxel layer z ∈ [0, v]; each averages the iso crossings on its
 * cell's twelve edges, which pulls the outline inward by a fraction of a voxel. The loop is
 * resampled to 3 x Voxel Resolution points.
 *
 * Works in plan coordinates (web x, z); returns the outer loop counter-clockwise when viewed
 * from above (Blender +Z).
 */
export function raftPerimeter(model: TriangleMesh, expand: number, voxelResolution: number): Point2[] {
  return raftOutline(model, expand, voxelResolution).polygon;
}

/**
 * Raft outline: the raw dual-contour boundary loop (as SLASG_Raft's Perimiter output, with each
 * vertex's height above the plate, Blender start vertex, counter-clockwise) and its 3 x Voxel Resolution
 * resample that becomes the raft n-gon. Roof and Cage columns stand on the raw loop. `others`
 * holds the outlines of parts set apart from the largest one.
 */
export function raftOutline(model: TriangleMesh, expand: number, voxelResolution: number): RaftLoop & { others: RaftLoop[] } {
  // Parts set apart on one plate each get their own raft. The parts come from the mesh itself
  // (connected pieces whose footprints, grown by Expand Width, touch), never from the coarse
  // trace, which on a spread-out plate can miss a narrow part entirely. A lone part is traced
  // exactly as Blender does; separate parts are traced one by one with the voxel also capped at
  // half the Expand Width, since the whole plate's voxel can be wider than a slender part.
  const fine = Math.max(0.25, expand / 2);
  const groups = partGroups(model, expand);
  if (groups.length <= 1) {
    const whole = traceOutline(model, expand, voxelResolution, Infinity);
    return whole.others.length === 0 ? whole : traceOutline(model, expand, voxelResolution, fine);
  }
  const traced = groups
    .map((triangles) => traceOutline(subMesh(model, triangles), expand, voxelResolution, fine))
    .filter((outline) => outline.polygon.length >= 3);
  if (traced.length === 0) return { raw: [], polygon: [], others: [] };
  const sizes = traced.map((outline) => Math.abs(area(outline.polygon)));
  const first = sizes.indexOf(Math.max(...sizes));
  return {
    raw: traced[first]!.raw,
    polygon: traced[first]!.polygon,
    others: traced.flatMap((outline, i) => i === first ? outline.others : [{ raw: outline.raw, polygon: outline.polygon }, ...outline.others]),
  };
}

/** One dual-contour trace at a voxel of at most `maxVoxel`; `others` are the further non-hole loops. */
function traceOutline(model: TriangleMesh, expand: number, voxelResolution: number, maxVoxel: number): RaftLoop & { others: RaftLoop[] } {
  const triangles = projectTriangles(model);
  if (triangles.length === 0) return { raw: [], polygon: [], others: [] };
  const bounds3 = bounds3d(model);
  const diagonal = Math.hypot(bounds3.max[0] - bounds3.min[0], bounds3.max[1] - bounds3.min[1], bounds3.max[2] - bounds3.min[2]);
  const voxel = Math.min((diagonal + 2 * expand) / voxelResolution, maxVoxel);
  const iso = expand + 0.1;
  const field = new PlanDistance(triangles, iso + 2 * voxel);

  const i0 = Math.floor((bounds3.min[0] - iso) / voxel) - 2;
  const i1 = Math.ceil((bounds3.max[0] + iso) / voxel) + 2;
  const j0 = Math.floor((bounds3.min[2] - iso) / voxel) - 2;
  const j1 = Math.ceil((bounds3.max[2] + iso) / voxel) + 2;
  const width = i1 - i0 + 1;
  const height = j1 - j0 + 1;
  const f0 = new Float64Array(width * height);
  const f1 = new Float64Array(width * height);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const d = field.distance((i0 + i) * voxel, (j0 + j) * voxel);
      f0[j * width + i] = d - iso;
      f1[j * width + i] = Math.hypot(d, voxel) - iso;
    }
  }

  const node = (i: number, j: number): Point2 => [(i0 + i) * voxel, (j0 + j) * voxel];
  const at = (grid: Float64Array, i: number, j: number) => grid[j * width + i]!;
  /** Dual vertex of the cell (i, j) in layer [0, v]: mean of its edge crossings, projected to plan. */
  const dual = (i: number, j: number): Point2 => {
    const [x, , z] = dual3(i, j);
    return [x, z];
  };
  /** Dual vertex (x, height, z): mean of the iso crossings on the cell's twelve edges. */
  const dual3 = (i: number, j: number): [number, number, number] => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    const corners: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    for (const [grid, height] of [[f0, 0], [f1, voxel]] as const) {
      for (let k = 0; k < 4; k += 1) {
        const [ai, aj] = corners[k]!;
        const [bi, bj] = corners[(k + 1) % 4]!;
        const a = at(grid, ai, aj);
        const b = at(grid, bi, bj);
        if ((a < 0) === (b < 0)) continue;
        const t = a / (a - b);
        const [ax, az] = node(ai, aj);
        const [bx, bz] = node(bi, bj);
        sx += ax + (bx - ax) * t;
        sy += height;
        sz += az + (bz - az) * t;
        n += 1;
      }
    }
    for (const [ci, cj] of corners) {
      const a = at(f0, ci, cj);
      const b = at(f1, ci, cj);
      if ((a < 0) === (b < 0)) continue;
      const [x, z] = node(ci, cj);
      sx += x;
      sy += voxel * (a / (a - b));
      sz += z;
      n += 1;
    }
    if (n === 0) {
      const [x, z] = node(i, j);
      return [x, 0, z];
    }
    return [sx / n, sy / n, sz / n];
  };

  const loops = traceContours(f0, width, height);
  if (loops.length === 0) return { raw: [], polygon: [], others: [] };
  const plans = loops.map((loop) => loop.map(([i, j]) => dual(i, j)));
  const sizes = plans.map((plan) => Math.abs(area(plan)));
  const largest = sizes.indexOf(Math.max(...sizes));
  // OpenVDB emits points leaf by leaf (8^3 blocks in x, y, z order), x-major inside a leaf, so
  // the perimeter curve starts at the loop vertex with the smallest such key (Blender X/Y; web
  // cell (i, j) spans Blender y cell -(j0 + j + 1)). Blender's loop then runs clockwise.
  const key = ([i, j]: [number, number]) => {
    const x = i0 + i;
    const y = -(j0 + j + 1);
    return [Math.floor(x / 8), Math.floor(y / 8), ((x % 8) + 8) % 8, ((y % 8) + 8) % 8];
  };
  const before = (a: number[], b: number[]) => a.findIndex((value, index) => value !== b[index]) >= 0 && a[a.findIndex((value, index) => value !== b[index])]! < b[a.findIndex((value, index) => value !== b[index])]!;
  const build = (cells: [number, number][], samples: number): RaftLoop => {
    let start = 0;
    cells.forEach((cell, index) => { if (before(key(cell), key(cells[start]!))) start = index; });
    let ordered = [...cells.slice(start), ...cells.slice(0, start)];
    if (area(ordered.map(([i, j]) => dual(i, j)).map(([x, z]) => [x, -z] as Point2)) > 0) ordered = [ordered[0]!, ...ordered.slice(1).reverse()];
    const clockwise = ordered.map(([i, j]) => dual3(i, j));
    // The perimeter curve itself runs counter-clockwise from the start vertex (Roof/Cage columns
    // follow it); Fill Curve reverses the corners, so the raft n-gon is the clockwise resample.
    const raw = [clockwise[0]!, ...clockwise.slice(1).reverse()];
    return { raw, polygon: resampleClosed(clockwise.map(([x, , z]) => [x, z] as Point2), samples) };
  };
  const main = build(loops[largest]!, 3 * voxelResolution);
  // Further loops that are not holes inside another loop (holes in a part are filled).
  const others = plans
    .map((_, index) => index)
    .filter((index) => index !== largest && !plans.some((plan, other) => other !== index && sizes[other]! > sizes[index]! && inside(plans[index]![0]!, plan)))
    .map((index) => build(loops[index]!, 3 * voxelResolution));
  return { ...main, others };
}

/**
 * Triangles grouped into parts: connected pieces of the mesh, merged while their plan bounding
 * boxes, grown by Expand Width, overlap (their rafts would touch).
 */
function partGroups(model: TriangleMesh, expand: number): number[][] {
  const count = model.indices.length / 3;
  const parent = new Int32Array(model.positions.length / 3).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  };
  const join = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let t = 0; t < count; t += 1) {
    join(model.indices[t * 3]!, model.indices[t * 3 + 1]!);
    join(model.indices[t * 3]!, model.indices[t * 3 + 2]!);
  }
  // Plan bounding box per connected piece.
  const pieces = new Map<number, { box: [number, number, number, number]; triangles: number[] }>();
  const p = model.positions;
  for (let t = 0; t < count; t += 1) {
    const root = find(model.indices[t * 3]!);
    let piece = pieces.get(root);
    if (!piece) pieces.set(root, (piece = { box: [Infinity, Infinity, -Infinity, -Infinity], triangles: [] }));
    piece.triangles.push(t);
    for (let k = 0; k < 3; k += 1) {
      const v = model.indices[t * 3 + k]! * 3;
      piece.box[0] = Math.min(piece.box[0], p[v]!);
      piece.box[1] = Math.min(piece.box[1], p[v + 2]!);
      piece.box[2] = Math.max(piece.box[2], p[v]!);
      piece.box[3] = Math.max(piece.box[3], p[v + 2]!);
    }
  }
  // Merge pieces whose grown boxes overlap: sweep along x.
  const list = [...pieces.values()].sort((a, b) => a.box[0] - b.box[0]);
  const group = list.map((_, i) => i);
  const top = (i: number): number => { while (group[i] !== i) { group[i] = group[group[i]!]!; i = group[i]!; } return i; };
  const reach = 2 * expand + 0.2;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length && list[j]!.box[0] <= list[i]!.box[2] + reach; j += 1) {
      const a = list[i]!.box;
      const b = list[j]!.box;
      if (b[1] <= a[3] + reach && a[1] <= b[3] + reach) group[top(i)] = top(j);
    }
  }
  const merged = new Map<number, number[]>();
  list.forEach((piece, i) => {
    const key = top(i);
    const triangles = merged.get(key);
    if (triangles) triangles.push(...piece.triangles); else merged.set(key, [...piece.triangles]);
  });
  return [...merged.values()];
}

/** The given triangles as their own mesh, vertices compacted so their own bounding box is used. */
function subMesh(model: TriangleMesh, triangles: readonly number[]): TriangleMesh {
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const p = model.positions;
  const indices = new Uint32Array(triangles.length * 3);
  triangles.forEach((t, n) => {
    for (let k = 0; k < 3; k += 1) {
      const index = model.indices[t * 3 + k]!;
      let mapped = remap.get(index);
      if (mapped === undefined) {
        mapped = positions.length / 3;
        remap.set(index, mapped);
        positions.push(p[index * 3]!, p[index * 3 + 1]!, p[index * 3 + 2]!);
      }
      indices[n * 3 + k] = mapped;
    }
  });
  return { positions: new Float32Array(positions), indices };
}

export interface RaftLoop {
  raw: [number, number, number][];
  polygon: Point2[];
}

/** Even-odd point in polygon. */
function inside([x, z]: Point2, polygon: readonly Point2[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) result = !result;
  }
  return result;
}

/**
 * Blender Face Corner Angle bisector at each corner, in web (x, z): the next-edge direction
 * rotated about the n-gon normal by half the interior angle (reflex corners handled). The
 * normal follows the winding in Blender's plan (x, y = -z), so either orientation works.
 */
export function cornerBisectors(polygon: readonly Point2[]): Point2[] {
  const plan = polygon.map(([x, z]) => [x, -z] as Point2);
  const up = area(plan) >= 0 ? 1 : -1;
  return plan.map((point, index) => {
    const previous = plan[(index - 1 + plan.length) % plan.length]!;
    const next = plan[(index + 1) % plan.length]!;
    const a = normalize2([previous[0] - point[0], previous[1] - point[1]]);
    const b = normalize2([next[0] - point[0], next[1] - point[1]]);
    let angle = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
    if ((a[0] * b[1] - a[1] * b[0]) * up > 0) angle = 2 * Math.PI - angle;
    const half = (angle / 2) * up;
    const rx = b[0] * Math.cos(half) - b[1] * Math.sin(half);
    const ry = b[0] * Math.sin(half) + b[1] * Math.cos(half);
    return [rx, -ry];
  });
}

function projectTriangles(model: TriangleMesh): [Point2, Point2, Point2][] {
  const out: [Point2, Point2, Point2][] = [];
  for (let face = 0; face < model.indices.length / 3; face += 1) {
    const p = [0, 1, 2].map((k) => {
      const i = model.indices[face * 3 + k]! * 3;
      return [model.positions[i]!, model.positions[i + 2]!] as Point2;
    }) as [Point2, Point2, Point2];
    out.push(p);
  }
  return out;
}

/** Unsigned distance in plan to the union of projected triangles, bucketed for speed. */
class PlanDistance {
  private cells = new Map<string, number[]>();
  private size: number;
  private boxes: Float64Array;
  constructor(private triangles: readonly [Point2, Point2, Point2][], private reach: number) {
    this.size = Math.max(reach, 0.5);
    this.boxes = new Float64Array(triangles.length * 4);
    triangles.forEach((triangle, index) => {
      const xs = triangle.map((p) => p[0]);
      const zs = triangle.map((p) => p[1]);
      this.boxes.set([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], index * 4);
      for (let ix = Math.floor(Math.min(...xs) / this.size); ix <= Math.floor(Math.max(...xs) / this.size); ix += 1) {
        for (let iz = Math.floor(Math.min(...zs) / this.size); iz <= Math.floor(Math.max(...zs) / this.size); iz += 1) {
          const key = `${ix}|${iz}`;
          const list = this.cells.get(key);
          if (list) list.push(index); else this.cells.set(key, [index]);
        }
      }
    });
  }

  distance(x: number, z: number): number {
    const cx = Math.floor(x / this.size);
    const cz = Math.floor(z / this.size);
    let best = Infinity;
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const index of this.cells.get(`${cx + dx}|${cz + dz}`) ?? []) {
          if (seen.has(index)) continue;
          seen.add(index);
          const box = index * 4;
          const gap = Math.hypot(Math.max(this.boxes[box]! - x, 0, x - this.boxes[box + 2]!), Math.max(this.boxes[box + 1]! - z, 0, z - this.boxes[box + 3]!));
          if (gap >= best) continue;
          const d = triangleDistance(this.triangles[index]!, x, z);
          if (d < best) best = d;
          if (best === 0) return 0;
        }
      }
    }
    return Math.min(best, this.reach * 4);
  }
}

function triangleDistance([a, b, c]: readonly [Point2, Point2, Point2], x: number, z: number): number {
  const d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (z - b[1]);
  const d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (z - c[1]);
  const d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (z - a[1]);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  if (!(negative && positive)) return 0;
  return Math.min(segmentDistance(a, b, x, z), segmentDistance(b, c, x, z), segmentDistance(c, a, x, z));
}

function segmentDistance(a: Point2, b: Point2, x: number, z: number): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const length = ex * ex + ez * ez;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / length));
  return Math.hypot(x - (a[0] + ex * t), z - (a[1] + ez * t));
}

/** Marching squares: closed loops of cells crossed by the zero contour, in walk order. */
function traceContours(field: Float64Array, width: number, height: number): [number, number][][] {
  const inside = (i: number, j: number) => field[j * width + i]! < 0;
  const caseOf = (i: number, j: number) =>
    (inside(i, j) ? 1 : 0) | (inside(i + 1, j) ? 2 : 0) | (inside(i + 1, j + 1) ? 4 : 0) | (inside(i, j + 1) ? 8 : 0);
  // Edges: 0 bottom (j), 1 right (i+1), 2 top (j+1), 3 left (i).
  const exits = (code: number, entry: number): number => {
    const pairs: Record<number, number[][]> = {
      1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [1, 0]], 6: [[0, 2]], 7: [[3, 2]],
      8: [[2, 3]], 9: [[2, 0]], 10: [[0, 3], [2, 1]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]],
    };
    for (const [a, b] of pairs[code] ?? []) {
      if (a === entry) return b!;
      if (b === entry) return a!;
    }
    return -1;
  };
  const visited = new Set<string>();
  const loops: [number, number][][] = [];
  for (let j = 0; j < height - 1; j += 1) {
    for (let i = 0; i < width - 1; i += 1) {
      const code = caseOf(i, j);
      if (code === 0 || code === 15 || visited.has(`${i}|${j}`)) continue;
      const first = ({ 1: [3, 0], 2: [0, 1], 3: [3, 1], 4: [1, 2], 5: [3, 2], 6: [0, 2], 7: [3, 2], 8: [2, 3], 9: [2, 0], 10: [0, 3], 11: [2, 1], 12: [1, 3], 13: [1, 0], 14: [0, 3] } as Record<number, number[]>)[code]!;
      const loop: [number, number][] = [];
      let [ci, cj] = [i, j];
      let entry = first[0]!;
      for (let guard = 0; guard < width * height * 2; guard += 1) {
        const key = `${ci}|${cj}`;
        if (visited.has(key) && loop.length > 0 && ci === i && cj === j) break;
        visited.add(key);
        loop.push([ci, cj]);
        const exit = exits(caseOf(ci, cj), entry);
        if (exit < 0) break;
        if (exit === 0) cj -= 1; else if (exit === 1) ci += 1; else if (exit === 2) cj += 1; else ci -= 1;
        entry = (exit + 2) % 4;
        if (ci < 0 || cj < 0 || ci >= width - 1 || cj >= height - 1) break;
        if (ci === i && cj === j) break;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/** Blender Resample Curve (Count) on a cyclic poly curve: points evenly spaced by length from the first point. */
export function resampleClosed(loop: readonly Point2[], count: number): Point2[] {
  const lengths = loop.map((point, index) => Math.hypot(loop[(index + 1) % loop.length]![0] - point[0], loop[(index + 1) % loop.length]![1] - point[1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const out: Point2[] = [];
  let segment = 0;
  let start = 0;
  for (let k = 0; k < count; k += 1) {
    const target = (k / count) * total;
    while (segment < loop.length - 1 && start + lengths[segment]! < target) {
      start += lengths[segment]!;
      segment += 1;
    }
    const a = loop[segment]!;
    const b = loop[(segment + 1) % loop.length]!;
    const t = lengths[segment]! === 0 ? 0 : (target - start) / lengths[segment]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function area(loop: readonly Point2[]): number {
  let sum = 0;
  loop.forEach((point, index) => {
    const next = loop[(index + 1) % loop.length]!;
    sum += point[0] * next[1] - next[0] * point[1];
  });
  return sum / 2;
}

function bounds3d(mesh: TriangleMesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, mesh.positions[offset + axis]!);
      max[axis] = Math.max(max[axis]!, mesh.positions[offset + axis]!);
    }
  }
  return { min, max };
}

function normalize2([x, y]: Point2): Point2 {
  const length = Math.hypot(x, y);
  return length === 0 ? [0, 0] : [x / length, y / length];
}
