import type { TriangleMesh } from '../analysis/types';

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
  const triangles = projectTriangles(model);
  if (triangles.length === 0) return [];
  const bounds3 = bounds3d(model);
  const diagonal = Math.hypot(bounds3.max[0] - bounds3.min[0], bounds3.max[1] - bounds3.min[1], bounds3.max[2] - bounds3.min[2]);
  const voxel = (diagonal + 2 * expand) / voxelResolution;
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
    let sx = 0;
    let sz = 0;
    let n = 0;
    const corners: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    for (const grid of [f0, f1]) {
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
        sz += az + (bz - az) * t;
        n += 1;
      }
    }
    for (const [ci, cj] of corners) {
      if ((at(f0, ci, cj) < 0) === (at(f1, ci, cj) < 0)) continue;
      const [x, z] = node(ci, cj);
      sx += x;
      sz += z;
      n += 1;
    }
    return n === 0 ? node(i, j) : [sx / n, sz / n];
  };

  const loops = traceContours(f0, width, height).map((cells) => cells.map(([i, j]) => dual(i, j)));
  if (loops.length === 0) return [];
  // Blender X/Y plan is web (x, -z): orient counter-clockwise there.
  let outer = loops.reduce((best, loop) => (Math.abs(area(loop)) > Math.abs(area(best)) ? loop : best));
  if (area(outer.map(([x, z]) => [x, -z] as Point2)) < 0) outer = [...outer].reverse();
  return resampleClosed(outer, 3 * voxelResolution);
}

/** Interior unit bisector at each corner of a counter-clockwise (Blender plan) polygon, in web (x, z). */
export function cornerBisectors(polygon: readonly Point2[]): Point2[] {
  return polygon.map((point, index) => {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length]!;
    const next = polygon[(index + 1) % polygon.length]!;
    // Work in Blender plan coordinates (x, y = -z), where the polygon is counter-clockwise.
    const a = normalize2([previous[0] - point[0], -(previous[1] - point[1])]);
    const b = normalize2([next[0] - point[0], -(next[1] - point[1])]);
    let angle = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
    if (a[0] * b[1] - a[1] * b[0] > 0) angle = 2 * Math.PI - angle;
    // Rotate b about +Z by half the corner angle.
    const half = angle / 2;
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
