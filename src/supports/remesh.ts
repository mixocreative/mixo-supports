import type { TriangleMesh } from '../analysis/types';

type Vector = [number, number, number];

interface Quad {
  corners: [Vector, Vector, Vector, Vector];
  /** Grid cell (i, j, k) of each corner: the remesh vertex identity. */
  cells: [number, number, number][];
  normal: Vector;
}

/**
 * Local emulation of the target SLASG_Line samples normals from and lands columns on: the model
 * through Mesh to SDF Grid (voxel h = max(bbox diagonal / 2000, Middle Ø)) and Grid to Mesh
 * (iso 0). OpenVDB places one dual vertex per sign-changing cell at the mean of its edge
 * crossings and one quad per sign-changing grid edge, so near edges and apexes the surface is
 * chamfered over about one voxel. Quads are built only around the points that are queried.
 */
export class RemeshTarget {
  readonly voxel: number;
  private readonly distance: SignedDistance;
  private readonly values = new Map<string, number>();
  private readonly duals = new Map<string, Vector | null>();
  private readonly quads = new Map<string, Quad | null>();
  readonly bottom: number;

  constructor(model: TriangleMesh, pillarDiameter: number) {
    let min: Vector = [Infinity, Infinity, Infinity];
    let max: Vector = [-Infinity, -Infinity, -Infinity];
    for (let offset = 0; offset < model.positions.length; offset += 3) {
      min = [Math.min(min[0], model.positions[offset]!), Math.min(min[1], model.positions[offset + 1]!), Math.min(min[2], model.positions[offset + 2]!)];
      max = [Math.max(max[0], model.positions[offset]!), Math.max(max[1], model.positions[offset + 1]!), Math.max(max[2], model.positions[offset + 2]!)];
    }
    // Geometry Nodes evaluates the voxel size in single precision.
    this.voxel = Math.fround(Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2000, pillarDiameter));
    this.bottom = min[1] - 2 * this.voxel;
    this.distance = new SignedDistance(model, this.voxel * 3);
  }

  /** Face normal of the nearest remesh face (`face` points) or nearest-edge normal (`edge` points). */
  normalAt(point: Vector, kind: 'face' | 'edge'): Vector | undefined {
    const quads = this.quadsAround(point, 1);
    if (quads.length === 0) return undefined;
    if (kind === 'face') {
      let best: Quad | undefined;
      let bestDistance = Infinity;
      for (const quad of quads) {
        const d = Math.min(triangleDistance(point, quad.corners[0], quad.corners[1], quad.corners[2]), triangleDistance(point, quad.corners[0], quad.corners[2], quad.corners[3]));
        if (d < bestDistance) {
          bestDistance = d;
          best = quad;
        }
      }
      return best!.normal;
    }
    // Nearest edge; Blender's edge normal is the mean of its two vertex normals.
    let bestEdge: [number, number, number][] | undefined;
    let bestDistance = Infinity;
    for (const quad of quads) {
      quad.corners.forEach((corner, k) => {
        const d = segmentDistance(point, corner, quad.corners[(k + 1) % 4]!);
        if (d < bestDistance) {
          bestDistance = d;
          bestEdge = [quad.cells[k]!, quad.cells[(k + 1) % 4]!];
        }
      });
    }
    return normalize(add(this.vertexNormal(bestEdge![0]!), this.vertexNormal(bestEdge![1]!)));
  }

  /** Blender vertex normal: face normals weighted by the corner angle (zero-length sides skipped). */
  private vertexNormal(cell: [number, number, number]): Vector {
    let sum: Vector = [0, 0, 0];
    for (const quad of this.quadsInCell(cell[0], cell[1], cell[2])) {
      quad.cells.forEach((corner, k) => {
        if (corner[0] !== cell[0] || corner[1] !== cell[1] || corner[2] !== cell[2]) return;
        const here = quad.corners[k]!;
        const a = sub(quad.corners[(k + 3) % 4]!, here);
        const b = sub(quad.corners[(k + 1) % 4]!, here);
        if (len(a) < 1e-9 || len(b) < 1e-9) return;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b)))));
        sum = add(sum, scale(quad.normal, angle));
      });
    }
    return normalize(sum);
  }

  /**
   * First remesh surface straight below `from` within `length`, with its upward normal. The
   * scan starts at height `start` (a caller that knows nothing lies above it can skip cells).
   */
  castDown(from: Vector, length: number, start = from[1]): { point: Vector; normal: Vector } | undefined {
    const h = this.voxel;
    const [cx, , cz] = from.map((value) => Math.floor(value / h));
    let best: { point: Vector; normal: Vector } | undefined;
    for (let y = Math.floor(Math.min(start, from[1]) / h) + 1; y * h >= from[1] - length - h && y * h >= this.bottom; y -= 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const quad of this.quadsInCell(cx! + dx, y, cz! + dz)) {
            for (const [a, b, c] of [[quad.corners[0], quad.corners[1], quad.corners[2]], [quad.corners[0], quad.corners[2], quad.corners[3]]] as [Vector, Vector, Vector][]) {
              const hit = verticalHit(from, a, b, c);
              if (hit === undefined || hit >= from[1] - 1e-6 || from[1] - hit > length) continue;
              if (!best || hit > best.point[1]) {
                let normal = quad.normal;
                if (normal[1] < 0) normal = [-normal[0], -normal[1], -normal[2]];
                best = { point: [from[0], hit, from[2]], normal };
              }
            }
          }
        }
      }
      if (best && best.point[1] > y * h + h) break;
    }
    return best;
  }

  private value(i: number, j: number, k: number): number {
    const key = `${i}|${j}|${k}`;
    let value = this.values.get(key);
    if (value === undefined) {
      value = this.distance.at([i * this.voxel, j * this.voxel, k * this.voxel]);
      // Nodes on the surface count as inside, as OpenVDB classifies them.
      if (Math.abs(value) < 1e-6) value = 0;
      this.values.set(key, value);
    }
    return value;
  }

  /** Dual vertex of cell (i, j, k): mean of the iso crossings on its twelve edges. */
  private dual(i: number, j: number, k: number): Vector | null {
    const key = `${i}|${j}|${k}`;
    if (this.duals.has(key)) return this.duals.get(key)!;
    const h = this.voxel;
    let sum: Vector = [0, 0, 0];
    let count = 0;
    const corner = (a: number, b: number, c: number): Vector => [(i + a) * h, (j + b) * h, (k + c) * h];
    const edges: [Vector, Vector, Vector, Vector][] = [];
    for (const [a, b, c] of [[0, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1]] as const) edges.push([[a, b, c], [1, b, c], corner(a, b, c), corner(1, b, c)] as never);
    for (const [a, b, c] of [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] as const) edges.push([[a, b, c], [a, 1, c], corner(a, b, c), corner(a, 1, c)] as never);
    for (const [a, b, c] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] as const) edges.push([[a, b, c], [a, b, 1], corner(a, b, c), corner(a, b, 1)] as never);
    for (const [p, q, pa, pb] of edges as unknown as [[number, number, number], [number, number, number], Vector, Vector][]) {
      const fa = this.value(i + p[0], j + p[1], k + p[2]);
      const fb = this.value(i + q[0], j + q[1], k + q[2]);
      if ((fa <= 0) === (fb <= 0)) continue;
      const t = fa / (fa - fb);
      sum = add(sum, add(pa, scale(sub(pb, pa), t)));
      count += 1;
    }
    const result = count === 0 ? null : scale(sum, 1 / count);
    this.duals.set(key, result);
    return result;
  }

  /** Quad of the grid edge from node (i, j, k) along `axis`, if it crosses the iso surface. */
  private quad(i: number, j: number, k: number, axis: 0 | 1 | 2): Quad | null {
    const key = `${i}|${j}|${k}|${axis}`;
    if (this.quads.has(key)) return this.quads.get(key)!;
    const step: Vector = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
    const fa = this.value(i, j, k);
    const fb = this.value(i + step[0], j + step[1], k + step[2]);
    let result: Quad | null = null;
    if ((fa <= 0) !== (fb <= 0)) {
      const [u, v] = ([0, 1, 2] as const).filter((other) => other !== axis) as [number, number];
      const cell = (du: number, dv: number): [number, number, number] => {
        const c: [number, number, number] = [i, j, k];
        c[u] -= du;
        c[v] -= dv;
        return c;
      };
      const cells = [cell(0, 0), cell(1, 0), cell(1, 1), cell(0, 1)];
      const corners = cells.map(([a, b, c]) => this.dual(a, b, c));
      if (corners.every((corner) => corner !== null)) {
        // Blender's vertex order for this quad (it fixes the 0-2 triangulation diagonal).
        const inside = fa <= 0;
        const order = axis === 1 ? (inside ? [2, 1, 0, 3] : [3, 0, 1, 2])
          : axis === 0 ? (inside ? [3, 0, 1, 2] : [2, 1, 0, 3])
            : (inside ? [1, 2, 3, 0] : [0, 3, 2, 1]);
        const pts = order.map((n) => corners[n]!) as [Vector, Vector, Vector, Vector];
        let normal: Vector = [0, 0, 0];
        pts.forEach((p, n) => {
          const q = pts[(n + 1) % 4]!;
          normal = add(normal, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
        });
        // OpenVDB emits coincident duplicate vertices where the surface passes through grid
        // nodes; the resulting zero-area quads carry no normal and add nothing.
        if (len(normal) < 1e-12) {
          this.quads.set(key, null);
          return null;
        }
        normal = normalize(normal);
        // Outward: from the inside node (negative) toward the outside one.
        const outward = fa <= 0 ? step : scale(step, -1);
        if (dot(normal, outward) < 0) normal = scale(normal, -1);
        result = { corners: pts, cells: order.map((n) => cells[n]!), normal };
      }
    }
    this.quads.set(key, result);
    return result;
  }

  /** Quads whose dual corners include cell (i, j, k). */
  private quadsInCell(i: number, j: number, k: number): Quad[] {
    const out: Quad[] = [];
    for (const axis of [0, 1, 2] as const) {
      const [u, v] = ([0, 1, 2] as const).filter((other) => other !== axis) as [number, number];
      for (let du = 0; du <= 1; du += 1) {
        for (let dv = 0; dv <= 1; dv += 1) {
          for (let da = 0; da <= 1; da += 1) {
            const node: [number, number, number] = [i, j, k];
            node[u] += du;
            node[v] += dv;
            node[axis] += da - (da === 1 ? 1 : 0);
            const quad = this.quad(node[0], node[1], node[2], axis);
            if (quad && !out.includes(quad)) out.push(quad);
          }
        }
      }
    }
    return out;
  }

  private quadsAround(point: Vector, radius: number): Quad[] {
    const [ci, cj, ck] = point.map((value) => Math.floor(value / this.voxel));
    const out = new Set<Quad>();
    for (let i = ci! - radius; i <= ci! + radius; i += 1) {
      for (let j = cj! - radius; j <= cj! + radius; j += 1) {
        for (let k = ck! - radius; k <= ck! + radius; k += 1) {
          for (const quad of this.quadsInCell(i, j, k)) out.add(quad);
        }
      }
    }
    return [...out];
  }
}

/** Signed distance to a closed mesh (negative inside), bucketed nearest-triangle search. */
class SignedDistance {
  private readonly triangles: [Vector, Vector, Vector][] = [];
  private readonly cells = new Map<string, number[]>();
  private readonly columns = new Map<string, number[]>();
  private readonly size: number;

  constructor(model: TriangleMesh, reach: number) {
    for (let face = 0; face < model.indices.length / 3; face += 1) {
      this.triangles.push([0, 1, 2].map((k) => {
        const i = model.indices[face * 3 + k]! * 3;
        return [model.positions[i]!, model.positions[i + 1]!, model.positions[i + 2]!] as Vector;
      }) as [Vector, Vector, Vector]);
    }
    this.size = Math.max(reach, 0.5);
    this.triangles.forEach((triangle, index) => {
      const lo = [0, 1, 2].map((axis) => Math.floor(Math.min(...triangle.map((p) => p[axis]!)) / this.size));
      const hi = [0, 1, 2].map((axis) => Math.floor(Math.max(...triangle.map((p) => p[axis]!)) / this.size));
      for (let x = lo[0]!; x <= hi[0]!; x += 1) {
        for (let z = lo[2]!; z <= hi[2]!; z += 1) {
          const column = `${x}|${z}`;
          const list = this.columns.get(column);
          if (list) list.push(index); else this.columns.set(column, [index]);
          for (let y = lo[1]!; y <= hi[1]!; y += 1) {
            const key = `${x}|${y}|${z}`;
            const cell = this.cells.get(key);
            if (cell) cell.push(index); else this.cells.set(key, [index]);
          }
        }
      }
    });
  }

  at(point: Vector): number {
    const cell = point.map((value) => Math.floor(value / this.size));
    let best = Infinity;
    for (let ring = 1; ring <= 4 && best === Infinity; ring += 1) {
      for (let x = -ring; x <= ring; x += 1) for (let y = -ring; y <= ring; y += 1) for (let z = -ring; z <= ring; z += 1) {
        for (const index of this.cells.get(`${cell[0]! + x}|${cell[1]! + y}|${cell[2]! + z}`) ?? []) {
          const [a, b, c] = this.triangles[index]!;
          best = Math.min(best, triangleDistance(point, a, b, c));
        }
      }
    }
    if (best === Infinity) best = this.size * 5;
    return this.inside(point) ? -best : best;
  }

  private inside(point: Vector): boolean {
    // Nudge the ray off grid-aligned vertices and edges, where parity would double count.
    point = [point[0] + 1.37e-6, point[1], point[2] + 0.71e-6];
    let crossings = 0;
    for (const index of this.columns.get(`${Math.floor(point[0] / this.size)}|${Math.floor(point[2] / this.size)}`) ?? []) {
      const [a, b, c] = this.triangles[index]!;
      const hit = verticalHit(point, a, b, c, true);
      if (hit !== undefined && hit > point[1]) crossings += 1;
    }
    return crossings % 2 === 1;
  }
}

/** Height where the vertical line through `p` meets triangle abc (half-open edges when `strict`). */
function verticalHit(p: Vector, a: Vector, b: Vector, c: Vector, strict = false): number | undefined {
  const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(det) < 1e-12) return undefined;
  const l1 = ((b[2] - c[2]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[2] - c[2])) / det;
  const l2 = ((c[2] - a[2]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[2] - c[2])) / det;
  const l3 = 1 - l1 - l2;
  if (strict ? (l1 < 0 || l2 < 0 || l3 <= 0) : (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9)) return undefined;
  return l1 * a[1] + l2 * b[1] + l3 * c[1];
}

function triangleDistance(p: Vector, a: Vector, b: Vector, c: Vector): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return len(sub(p, add(a, scale(ab, d1 / (d1 - d3)))));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return len(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return len(sub(p, add(a, scale(ac, d2 / (d2 - d6)))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return len(sub(p, add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))))));
  const denominator = 1 / (va + vb + vc);
  return len(sub(p, add(a, add(scale(ab, vb * denominator), scale(ac, vc * denominator)))));
}

function segmentDistance(p: Vector, a: Vector, b: Vector): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12)));
  return len(sub(p, add(a, scale(ab, t))));
}

function add(a: Vector, b: Vector): Vector { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: Vector, b: Vector): Vector { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(v: Vector, s: number): Vector { return [v[0] * s, v[1] * s, v[2] * s]; }
function dot(a: Vector, b: Vector): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(v: Vector): number { return Math.hypot(v[0], v[1], v[2]); }
function normalize(v: Vector): Vector {
  const length = len(v);
  return length === 0 ? [0, -1, 0] : [v[0] / length, v[1] / length, v[2] / length];
}
