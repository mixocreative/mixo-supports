import type { TriangleMesh } from '../analysis/types';
import { ADAPTABLE, AMBIGUOUS_FACE, EDGE_GROUPS } from './openvdbTables';

type Vector = [number, number, number];
type Index = [number, number, number];

/** A face of the remesh in web space. `vertices` are the remesh vertex identities. */
export interface Polygon {
  corners: Vector[];
  vertices: string[];
  normal: Vector;
}

/** A face as OpenVDB emits it: vertex identities in output order. */
interface Prim {
  ids: string[];
  triangle: boolean;
}

interface Leaf {
  /** Region id per surface cell key (cells outside any region are absent). */
  region: Map<string, number>;
  /** Surface cells of each region. */
  members: Map<number, Index[]>;
}

const LEAF = 8;
const key = (c: readonly number[]) => `${c[0]},${c[1]},${c[2]}`;
/** Packed numeric key for per-node caches (17 bits per axis, about +-65k voxels). */
const nodeKey = (c: readonly number[]) => ((c[0]! + 65536) * 131072 + (c[1]! + 65536)) * 131072 + (c[2]! + 65536);

/**
 * Blender's Mesh to SDF Grid + Grid to Mesh, reproduced from OpenVDB's VolumeToMesh around the
 * points that are queried. Work happens in Blender's index space (x, y, z) = web (x, -z, y)
 * so that leaf alignment, sign tables and quad order match OpenVDB:
 * - nodes sit at multiples of the voxel; a node on the surface counts as inside;
 * - each sign-changing cell gets one point per edge group at the mean of that group's edge
 *   crossings, and each sign-changing grid edge one quad of the four surrounding points;
 * - with adaptivity, cells inside each 8^3 leaf merge into 2^3, 4^3 and 8^3 regions when the
 *   block is manifold and every pair of cell gradients satisfies 1 - dot <= adaptivity; a
 *   region has one point, the mean of its cells' points, and quads collapse to triangles or
 *   vanish where corners share a point;
 * - points of triangles facing more than 120° away from the field gradient move to the mean
 *   of the polygons around them (relaxDisorientedTriangles).
 */
export class RemeshTarget {
  readonly voxel: number;
  /** Lowest web height the remesh can reach. */
  readonly bottom: number;
  private readonly bounds: [Vector, Vector];
  private readonly adaptivity: number;
  private readonly distance: SignedDistance;
  private readonly values = new Map<number, number>();
  private readonly exactValues = new Map<number, number>();
  private readonly signCache = new Map<number, number>();
  private readonly leaves = new Map<string, Leaf>();
  private readonly prims = new Map<string, Prim | null>();
  private readonly raw = new Map<string, Vector>();
  private readonly final = new Map<string, Vector>();
  private readonly polygonCache = new Map<string, Polygon | null>();
  private readonly emptyLeaves = new Map<string, boolean>();

  /**
   * `voxel` overrides SLASG_Line's size (the scatter remeshes at Spacing / 4); `adaptivity`
   * is Grid to Mesh's (0.1 in SLASG).
   */
  constructor(model: TriangleMesh, pillarDiameter: number, voxel?: number, adaptivity = 0.1) {
    let min: Vector = [Infinity, Infinity, Infinity];
    let max: Vector = [-Infinity, -Infinity, -Infinity];
    for (let offset = 0; offset < model.positions.length; offset += 3) {
      min = [Math.min(min[0], model.positions[offset]!), Math.min(min[1], model.positions[offset + 1]!), Math.min(min[2], model.positions[offset + 2]!)];
      max = [Math.max(max[0], model.positions[offset]!), Math.max(max[1], model.positions[offset + 1]!), Math.max(max[2], model.positions[offset + 2]!)];
    }
    // Geometry Nodes evaluates the voxel size in single precision.
    this.voxel = Math.fround(voxel ?? Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2000, pillarDiameter));
    this.adaptivity = Math.fround(adaptivity);
    this.bottom = min[1] - 2 * this.voxel;
    this.bounds = [min, max];
    // meshToVolume measures distance in index space from single-precision index points.
    const h = this.voxel;
    const indexPositions = new Float32Array(model.positions.length);
    model.positions.forEach((v, n) => { indexPositions[n] = Math.fround(Math.fround(v) / h); });
    this.distance = new SignedDistance({ positions: indexPositions, indices: model.indices });
  }

  /** Face normal of the nearest remesh face (`face` points) or nearest-edge normal (`edge` points). */
  normalAt(point: Vector, kind: 'face' | 'edge'): Vector | undefined {
    const polygons = this.polygonsNear(point);
    if (polygons.length === 0) return undefined;
    if (kind === 'face') {
      let best: Polygon | undefined;
      let bestDistance = Infinity;
      for (const polygon of polygons) {
        const d = Math.min(...fan(polygon.corners).map(([a, b, c]) => triangleDistance(point, a, b, c)));
        if (d < bestDistance) {
          bestDistance = d;
          best = polygon;
        }
      }
      return best!.normal;
    }
    // Nearest edge; Blender's edge normal is the mean of its two vertex normals.
    let bestEdge: [string, string] | undefined;
    let bestDistance = Infinity;
    for (const polygon of polygons) {
      const n = polygon.corners.length;
      polygon.corners.forEach((corner, k) => {
        const d = segmentDistance(point, corner, polygon.corners[(k + 1) % n]!);
        if (d < bestDistance) {
          bestDistance = d;
          bestEdge = [polygon.vertices[k]!, polygon.vertices[(k + 1) % n]!];
        }
      });
    }
    return normalize(add(this.vertexNormal(bestEdge![0]), this.vertexNormal(bestEdge![1])));
  }

  /** Polygons from leaves near the vertical line through (x, z), between web heights `top` and `bottom`. */
  polygonsNearColumn(x: number, z: number, radius: number, top: number, bottom: number): Polygon[] {
    const h = this.voxel;
    const out = new Set<Polygon>();
    const leafRange = (lo: number, hi: number) => [Math.floor(Math.floor(lo / h) / LEAF) - 1, Math.floor(Math.floor(hi / h) / LEAF) + 1];
    const [i0, i1] = leafRange(x - radius, x + radius);
    const [j0, j1] = leafRange(-z - radius, -z + radius);
    const [k0, k1] = leafRange(Math.max(bottom, this.bottom), top);
    for (let i = i0!; i <= i1!; i += 1) for (let j = j0!; j <= j1!; j += 1) for (let k = k0!; k <= k1!; k += 1) {
      for (const polygon of this.leafPolygons([i * LEAF, j * LEAF, k * LEAF])) out.add(polygon);
    }
    return [...out];
  }

  /**
   * Blender vertex normal: face normals weighted by the corner angle (zero-length sides
   * skipped), over the polygons that `keep` admits (the faces of a separated mesh).
   */
  vertexNormal(id: string, keep: (polygon: Polygon) => boolean = () => true): Vector {
    let sum: Vector = [0, 0, 0];
    for (const polygon of this.star(id)) {
      if (!keep(polygon)) continue;
      const n = polygon.corners.length;
      polygon.vertices.forEach((vertex, k) => {
        if (vertex !== id) return;
        const here = polygon.corners[k]!;
        const a = sub(polygon.corners[(k + n - 1) % n]!, here);
        const b = sub(polygon.corners[(k + 1) % n]!, here);
        if (len(a) < 1e-9 || len(b) < 1e-9) return;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b)))));
        sum = add(sum, scale(polygon.normal, angle));
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
    const li = Math.floor(Math.floor(from[0] / h) / LEAF);
    const lj = Math.floor(Math.floor(-from[2] / h) / LEAF);
    let best: { point: Vector; normal: Vector } | undefined;
    const top = Math.floor(Math.floor(Math.min(start, from[1]) / h) / LEAF) + 1;
    const lowest = Math.floor(Math.floor(Math.max(from[1] - length, this.bottom) / h) / LEAF) - 1;
    for (let lk = top; lk >= lowest; lk -= 1) {
      for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1) {
        for (const polygon of this.leafPolygons([(li + di) * LEAF, (lj + dj) * LEAF, lk * LEAF])) {
          for (const [a, b, c] of fan(polygon.corners)) {
            const hit = verticalHit(from, a, b, c);
            if (hit === undefined || hit >= from[1] - 1e-6 || from[1] - hit > length) continue;
            if (!best || hit > best.point[1]) {
              const normal = polygon.normal[1] < 0 ? scale(polygon.normal, -1) : polygon.normal;
              best = { point: [from[0], hit, from[2]], normal };
            }
          }
        }
      }
      // Polygons of a leaf reach at most one leaf beyond it.
      if (best && best.point[1] > (lk * LEAF + 2 * LEAF) * h) break;
    }
    return best;
  }

  /**
   * The whole remesh as Grid to Mesh outputs it: vertices in OpenVDB order (leaf by leaf; in a
   * leaf, unmerged cell points by voxel offset, then region points by region id) and faces in
   * Blender's order (every triangle, then every quad, each leaf by leaf). Zero-area faces keep
   * their place with a null normal. Positions and normals are web space.
   */
  fullMesh(onProgress?: (fraction: number) => void): { vertices: Vector[]; faces: number[][]; normals: (Vector | null)[] } {
    const h = this.voxel;
    const [min, max] = this.bounds;
    // Blender index space: (x, -z, y) of web.
    const lo = [min[0], -max[2], min[1]].map((v) => Math.floor(Math.floor(v / h) / LEAF) - 1);
    const hi = [max[0], -min[2], max[1]].map((v) => Math.floor(Math.floor(v / h) / LEAF) + 1);
    const origins: Index[] = [];
    for (let i = lo[0]!; i <= hi[0]!; i += 1) for (let j = lo[1]!; j <= hi[1]!; j += 1) for (let k = lo[2]!; k <= hi[2]!; k += 1) {
      origins.push([i * LEAF, j * LEAF, k * LEAF]);
    }
    // OpenVDB tree order: root children by origin (x, y, z), then child offsets x-major at
    // each internal level (4096 and 128 voxels).
    const order = (c: Index) => [4096, 128, 8].flatMap((size) => c.map((v) => Math.floor(v / size)));
    origins.sort((a, b) => {
      const ka = order(a);
      const kb = order(b);
      for (let n = 0; n < ka.length; n += 1) if (ka[n] !== kb[n]) return ka[n]! - kb[n]!;
      return 0;
    });
    const index = new Map<string, number>();
    const vertices: Vector[] = [];
    const triangles: number[][] = [];
    const quads: number[][] = [];
    const idOf = (id: string) => {
      let n = index.get(id);
      if (n === undefined) {
        index.set(id, (n = vertices.length));
        vertices.push(toWeb(this.finalPoint(id)));
      }
      return n;
    };
    origins.forEach((origin, done) => {
      if (done % 32 === 0) onProgress?.(done / origins.length);
      if (!this.leafCanHaveSurface(origin)) return;
      const leaf = this.leaf(origin);
      const cells: Index[] = [];
      for (let i = 0; i < LEAF; i += 1) for (let j = 0; j < LEAF; j += 1) for (let k = 0; k < LEAF; k += 1) {
        const c: Index = [origin[0] + i, origin[1] + j, origin[2] + k];
        if (this.surface(c)) cells.push(c);
      }
      for (const c of cells) {
        if (leaf.region.has(key(c))) continue;
        for (let group = 1; group <= EDGE_GROUPS[this.signs(c)]![0]!; group += 1) idOf(`C${key(c)}#${group}`);
      }
      for (const region of [...leaf.members.keys()].sort((a, b) => a - b)) idOf(`R${key(origin)}#${region}`);
      for (const c of cells) {
        for (const axis of [0, 1, 2] as const) {
          const prim = this.prim(c, axis);
          if (prim) (prim.triangle ? triangles : quads).push(prim.ids.map(idOf));
        }
      }
    });
    const faces = [...triangles, ...quads];
    const normals = faces.map((face) => {
      let normal: Vector = [0, 0, 0];
      face.forEach((v, n) => {
        const p = vertices[v]!;
        const q = vertices[face[(n + 1) % face.length]!]!;
        normal = add(normal, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
      });
      return len(normal) < 1e-12 ? null : normalize(normal);
    });
    onProgress?.(1);
    return { vertices, faces, normals };
  }

  /** Vertex positions (web) of the polygons of the leaves overlapping a web-space box. */
  verticesInBox(min: Vector, max: Vector): Vector[] {
    const out = new Map<string, Vector>();
    for (const polygon of this.polygonsNearColumn((min[0] + max[0]) / 2, (min[2] + max[2]) / 2, Math.max(max[0] - min[0], max[2] - min[2]) / 2, max[1], min[1])) {
      polygon.vertices.forEach((id, k) => out.set(id, polygon.corners[k]!));
    }
    return [...out.values()];
  }

  // ---- OpenVDB internals, Blender index space ----

  /** Exact signed distance at node c (single precision), as meshToVolume voxelizes it. */
  private exact(c: Index): number {
    const k = nodeKey(c);
    let value = this.exactValues.get(k);
    if (value === undefined) {
      // Beyond the 3-voxel band only the sign matters.
      value = Math.fround(Math.fround(this.distance.at([c[0], c[2], -c[1]], 4)) * this.voxel);
      this.exactValues.set(k, value);
    }
    return value;
  }

  /**
   * Grid value at node c. meshToVolume keeps a band of 3 voxels each side (beyond it the
   * background, +-3 voxels) and renormalizes it: values move in by 0.8 voxel, take the min
   * with one Godunov reinitialization step, and move back by 0.8 voxel - 1e-7.
   */
  private value(c: Index): number {
    const k = nodeKey(c);
    let value = this.values.get(k);
    if (value !== undefined) return value;
    const h = this.voxel;
    const band = Math.fround(3 * h);
    const offset = Math.fround(0.8 * h);
    const back = Math.fround(offset - Math.fround(1e-7));
    const shifted = (n: Index) => {
      const d = this.exact(n);
      return Math.abs(d) < band ? Math.fround(d - offset) : (d < 0 ? -band : band);
    };
    const d = this.exact(c);
    if (Math.abs(d) >= band) {
      value = d < 0 ? -band : band;
    } else {
      const phi = shifted(c);
      const [i, j, kk] = c;
      const up = [shifted([i + 1, j, kk]) - phi, shifted([i, j + 1, kk]) - phi, shifted([i, j, kk + 1]) - phi].map(Math.fround);
      const down = [phi - shifted([i - 1, j, kk]), phi - shifted([i, j - 1, kk]), phi - shifted([i, j, kk - 1])].map(Math.fround);
      let normSq = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        normSq += phi > 0
          ? Math.max(Math.max(down[axis]!, 0) ** 2, Math.min(up[axis]!, 0) ** 2)
          : Math.max(Math.min(down[axis]!, 0) ** 2, Math.max(up[axis]!, 0) ** 2);
      }
      normSq = Math.fround(normSq);
      const diff = Math.fround(Math.fround(Math.sqrt(normSq)) / h - 1);
      const sign = Math.fround(phi / Math.fround(Math.sqrt(phi * phi + normSq)));
      const renormalized = Math.fround(phi - Math.fround(h * sign * diff));
      value = Math.fround(Math.min(phi, renormalized) + back);
    }
    this.values.set(k, value);
    return value;
  }

  /** OpenVDB isInsideValue: strictly below the iso value 0. */
  private inside(c: Index): boolean {
    return this.value(c) < 0;
  }

  /** The eight corner values in OpenVDB order. */
  private cornerValues([i, j, k]: Index): number[] {
    return [[i, j, k], [i + 1, j, k], [i + 1, j, k + 1], [i, j, k + 1], [i, j + 1, k], [i + 1, j + 1, k], [i + 1, j + 1, k + 1], [i, j + 1, k + 1]]
      .map((c) => this.value(c as Index));
  }

  private rawSigns(c: Index): number {
    return this.cornerValues(c).reduce((signs, v, n) => signs | (v < 0 ? 1 << n : 0), 0);
  }

  /** Cell signs after OpenVDB's ambiguous-face correction. */
  private signs(c: Index): number {
    const k = nodeKey(c);
    let signs = this.signCache.get(k);
    if (signs !== undefined) return signs;
    signs = this.rawSigns(c);
    const face = AMBIGUOUS_FACE[signs]!;
    if (signs !== 0 && signs !== 0xff && face !== 0) {
      const [i, j, kk] = c;
      const check: Record<number, [Index, number]> = {
        1: [[i, j, kk - 1], 3], 2: [[i + 1, j, kk], 4], 3: [[i, j, kk + 1], 1],
        4: [[i - 1, j, kk], 2], 5: [[i, j - 1, kk], 6], 6: [[i, j + 1, kk], 5],
      };
      const [neighbour, expected] = check[face]!;
      if (AMBIGUOUS_FACE[this.rawSigns(neighbour)] === expected) signs = ~signs & 0xff;
    }
    this.signCache.set(k, signs);
    return signs;
  }

  private surface(c: Index): boolean {
    const signs = this.signs(c);
    return signs !== 0 && signs !== 0xff;
  }

  /** Mean of the crossings of one edge group, in cell-local index units. */
  private groupPoint(c: Index, group: number): Vector {
    const v = this.cornerValues(c);
    const groups = EDGE_GROUPS[this.signs(c)]!;
    const t = (a: number, b: number) => v[a]! / (v[a]! - v[b]!);
    const edges: [number, () => Vector][] = [
      [1, () => [t(0, 1), 0, 0]], [2, () => [1, 0, t(1, 2)]], [3, () => [t(3, 2), 0, 1]], [4, () => [0, 0, t(0, 3)]],
      [5, () => [t(4, 5), 1, 0]], [6, () => [1, 1, t(5, 6)]], [7, () => [t(7, 6), 1, 1]], [8, () => [0, 1, t(4, 7)]],
      [9, () => [0, t(0, 4), 0]], [10, () => [1, t(1, 5), 0]], [11, () => [1, t(2, 6), 1]], [12, () => [0, t(3, 7), 1]],
    ];
    let sum: Vector = [0, 0, 0];
    let samples = 0;
    for (const [edge, at] of edges) {
      if (groups[edge] !== group) continue;
      sum = add(sum, at());
      samples += 1;
    }
    return samples > 1 ? scale(sum, 1 / samples) : sum;
  }

  private nonManifold([i, j, k]: Index, dim: number): boolean {
    const h = dim >> 1;
    const p = [[i, j, k], [i + dim, j, k], [i + dim, j, k + dim], [i, j, k + dim], [i, j + dim, k], [i + dim, j + dim, k], [i + dim, j + dim, k + dim], [i, j + dim, k + dim]]
      .map((c) => this.inside(c as Index));
    const signs = p.reduce((s, inside, n) => s | (inside ? 1 << n : 0), 0);
    if (!ADAPTABLE[signs]) return true;
    const m = (c: Index) => this.inside(c);
    const [ip, ipp, jp, jpp, kp, kpp] = [i + h, i + dim, j + h, j + dim, k + h, k + dim];
    const edges: [Index, number, number][] = [
      [[ip, j, k], 0, 1], [[ipp, j, kp], 1, 2], [[ip, j, kpp], 2, 3], [[i, j, kp], 0, 3],
      [[ip, jpp, k], 4, 5], [[ipp, jpp, kp], 5, 6], [[ip, jpp, kpp], 6, 7], [[i, jpp, kp], 7, 4],
      [[i, jp, k], 0, 4], [[ipp, jp, k], 1, 5], [[ipp, jp, kpp], 2, 6], [[i, jp, kpp], 3, 7],
    ];
    for (const [c, a, b] of edges) {
      const v = m(c);
      if (p[a] !== v && p[b] !== v) return true;
    }
    const faces: [Index, number[]][] = [
      [[ip, jp, k], [0, 1, 4, 5]], [[ipp, jp, kp], [1, 2, 5, 6]], [[ip, jp, kpp], [2, 3, 6, 7]],
      [[i, jp, kp], [0, 3, 4, 7]], [[ip, j, kp], [0, 1, 2, 3]], [[ip, jpp, kp], [4, 5, 6, 7]],
    ];
    for (const [c, corners] of faces) {
      const v = m(c);
      if (corners.every((n) => p[n] !== v)) return true;
    }
    const centre = m([ip, jp, kp]);
    return p.every((v) => v !== centre);
  }

  /** Normalised central-difference gradient at node c, in single precision. */
  private gradient([i, j, k]: Index): Vector {
    const g: Vector = [
      Math.fround((this.value([i + 1, j, k]) - this.value([i - 1, j, k])) * 0.5),
      Math.fround((this.value([i, j + 1, k]) - this.value([i, j - 1, k])) * 0.5),
      Math.fround((this.value([i, j, k + 1]) - this.value([i, j, k - 1])) * 0.5),
    ];
    const length = Math.hypot(...g);
    return length === 0 ? g : g.map((v) => Math.fround(v / length)) as Vector;
  }

  /** The leaf might hold surface cells (the field changes sign within reach of it). */
  private leafCanHaveSurface(origin: Index): boolean {
    const k = key(origin);
    let result = this.emptyLeaves.get(k);
    if (result === undefined) {
      const centre: Index = [origin[0] + LEAF / 2, origin[1] + LEAF / 2, origin[2] + LEAF / 2];
      const d = this.distance.at([centre[0], centre[2], -centre[1]], 12);
      result = Math.abs(d) <= (LEAF / 2 + 2) * Math.sqrt(3);
      this.emptyLeaves.set(k, result);
    }
    return result;
  }

  /** MergeVoxelRegions for the leaf whose origin is `origin`. */
  private leaf(origin: Index): Leaf {
    const k = key(origin);
    const cached = this.leaves.get(k);
    if (cached) return cached;
    const result: Leaf = { region: new Map(), members: new Map() };
    this.leaves.set(k, result);
    if (this.adaptivity <= 1e-7 || !this.leafCanHaveSurface(origin)) return result;
    const cells: Index[] = [];
    for (let i = 0; i < LEAF; i += 1) for (let j = 0; j < LEAF; j += 1) for (let kk = 0; kk < LEAF; kk += 1) {
      const c: Index = [origin[0] + i, origin[1] + j, origin[2] + kk];
      if (this.surface(c)) cells.push(c);
    }
    if (cells.length === 0) return result;
    const even = (c: Index): Index => [c[0] & ~1, c[1] & ~1, c[2] & ~1];
    const mask = new Set<string>();
    for (const c of cells) {
      const signs = this.signs(c);
      if (!ADAPTABLE[signs] || EDGE_GROUPS[signs]![0]! > 1) mask.add(key(even(c)));
    }
    for (let i = 0; i < LEAF; i += 2) for (let j = 0; j < LEAF; j += 2) for (let kk = 0; kk < LEAF; kk += 2) {
      const b: Index = [origin[0] + i, origin[1] + j, origin[2] + kk];
      if (!mask.has(key(b)) && this.nonManifold(b, 2)) mask.add(key(b));
    }
    const gradients = new Map<string, Vector>();
    for (const c of cells) if (!mask.has(key(even(c)))) gradients.set(key(c), this.gradient(c));
    const mergeable = (b: Index, dim: number) => {
      const norms: Vector[] = [];
      for (let i = 0; i < dim; i += 1) for (let j = 0; j < dim; j += 1) for (let kk = 0; kk < dim; kk += 1) {
        const g = gradients.get(key([b[0] + i, b[1] + j, b[2] + kk]));
        if (g) norms.push(g);
      }
      for (const a of norms) for (const n of norms) {
        if (1 - Math.fround(Math.fround(Math.fround(a[0] * n[0]) + Math.fround(a[1] * n[1])) + Math.fround(a[2] * n[2])) > this.adaptivity) return false;
      }
      return true;
    };
    const assignment = new Map<string, number>();
    let regionId = 1;
    for (let dim = 2; dim <= LEAF; dim <<= 1) {
      const coordMask = ~((dim << 1) - 1);
      for (let i = 0; i < LEAF; i += dim) for (let j = 0; j < LEAF; j += dim) for (let kk = 0; kk < LEAF; kk += dim) {
        const b: Index = [origin[0] + i, origin[1] + j, origin[2] + kk];
        if (mask.has(key(b)) || this.nonManifold(b, dim) || !mergeable(b, dim)) {
          mask.add(key([b[0] & coordMask, b[1] & coordMask, b[2] & coordMask]));
        } else {
          for (let a = 0; a < dim; a += 1) for (let c = 0; c < dim; c += 1) for (let d = 0; d < dim; d += 1) {
            assignment.set(key([b[0] + a, b[1] + c, b[2] + d]), regionId);
          }
          regionId += 1;
        }
      }
    }
    for (const c of cells) {
      const id = assignment.get(key(c));
      if (id === undefined) continue;
      result.region.set(key(c), id);
      const list = result.members.get(id);
      if (list) list.push(c); else result.members.set(id, [c]);
    }
    return result;
  }

  private leafOf(c: Index): Index {
    return [Math.floor(c[0] / LEAF) * LEAF, Math.floor(c[1] / LEAF) * LEAF, Math.floor(c[2] / LEAF) * LEAF];
  }

  private pointId(c: Index, group: number): string {
    const origin = this.leafOf(c);
    const region = this.leaf(origin).region.get(key(c));
    return region !== undefined ? `R${key(origin)}#${region}` : `C${key(c)}#${group}`;
  }

  /** Cells a vertex is computed from. */
  private vertexCells(id: string): Index[] {
    const [head, tail] = id.slice(1).split('#') as [string, string];
    const c = head.split(',').map(Number) as Index;
    return id[0] === 'R' ? this.leaf(c).members.get(Number(tail))! : [c];
  }

  /** Point before relaxation, Blender world space. */
  private rawPoint(id: string): Vector {
    let point = this.raw.get(id);
    if (point) return point;
    const h = this.voxel;
    if (id[0] === 'R') {
      const cells = this.vertexCells(id);
      const sum = cells.reduce<Vector>((acc, c) => add(acc, add(c, this.groupPoint(c, 1))), [0, 0, 0]);
      point = scale(sum, h / cells.length);
    } else {
      const [head, tail] = id.slice(1).split('#') as [string, string];
      const c = head.split(',').map(Number) as Index;
      point = scale(add(c, this.groupPoint(c, Number(tail))), h);
    }
    point = point.map((v) => Math.fround(v)) as Vector;
    this.raw.set(id, point);
    return point;
  }

  /** The OpenVDB primitive of the grid edge from node n along `axis`, if it crosses the surface. */
  private prim(n: Index, axis: 0 | 1 | 2): Prim | null {
    const k = `${key(n)}|${axis}`;
    if (this.prims.has(k)) return this.prims.get(k)!;
    let result: Prim | null = null;
    const next: Index = [n[0] + (axis === 0 ? 1 : 0), n[1] + (axis === 1 ? 1 : 0), n[2] + (axis === 2 ? 1 : 0)];
    const isInside = this.inside(n);
    if (isInside !== this.inside(next)) {
      const [i, j, kk] = n;
      // Neighbour cells and the table edge that names the shared edge in each of them.
      const ring: [Index, number][] = axis === 0
        ? [[n, 1], [[i, j - 1, kk], 5], [[i, j - 1, kk - 1], 7], [[i, j, kk - 1], 3]]
        : axis === 1
          ? [[n, 9], [[i, j, kk - 1], 12], [[i - 1, j, kk - 1], 11], [[i - 1, j, kk], 10]]
          : [[n, 4], [[i, j - 1, kk], 8], [[i - 1, j - 1, kk], 6], [[i - 1, j, kk], 2]];
      const ids = ring.map(([c, edge]) => {
        const groups = EDGE_GROUPS[this.signs(c)]!;
        return this.pointId(c, groups[0]! > 1 ? groups[edge]! : 1);
      });
      // Blender's SDF grid is not tagged as a level set, so OpenVDB inverts the orientation.
      const reverse = axis === 2 ? isInside : !isInside;
      result = collapse(ids, reverse);
    }
    this.prims.set(k, result);
    return result;
  }

  /** Primitives of the twelve edges of cell c. */
  private cellPrims([i, j, k]: Index): Prim[] {
    const out: Prim[] = [];
    const add = (p: Prim | null) => { if (p && !out.includes(p)) out.push(p); };
    for (let a = 0; a <= 1; a += 1) for (let b = 0; b <= 1; b += 1) {
      add(this.prim([i, j + a, k + b], 0));
      add(this.prim([i + a, j, k + b], 1));
      add(this.prim([i + a, j + b, k], 2));
    }
    return out;
  }

  private starPrims(id: string): Prim[] {
    const out = new Set<Prim>();
    for (const c of this.vertexCells(id)) for (const p of this.cellPrims(c)) if (p.ids.includes(id)) out.add(p);
    return [...out];
  }

  /** relaxDisorientedTriangles: final point position, Blender world space. */
  private finalPoint(id: string): Vector {
    let point = this.final.get(id);
    if (point) return point;
    point = this.rawPoint(id);
    if (this.adaptivity > 1e-7) {
      const star = this.starPrims(id);
      if (star.some((p) => p.triangle && this.disoriented(p))) {
        let sum: Vector = [0, 0, 0];
        let count = 0;
        for (const p of star) {
          for (const v of p.ids) sum = add(sum, this.rawPoint(v));
          count += p.ids.length;
        }
        point = scale(sum, 1 / count).map((v) => Math.fround(v)) as Vector;
      }
    }
    this.final.set(id, point);
    return point;
  }

  private disoriented(prim: Prim): boolean {
    const [v0, v1, v2] = prim.ids.map((id) => this.rawPoint(id)) as [Vector, Vector, Vector];
    const normal = normalize(cross(sub(v2, v0), sub(v1, v0)));
    const centroid = scale(add(add(v0, v1), v2), 1 / 3);
    const cell = centroid.map((v) => Math.floor(v / this.voxel + 0.5)) as Index;
    // The inverted orientation flips the gradient too (invertGradientDir).
    return -dot(this.gradient(cell), normal) < -0.5;
  }

  /** Web-space polygon of a primitive. */
  private polygon(prim: Prim): Polygon | null {
    const k = prim.ids.join('/');
    if (this.polygonCache.has(k)) return this.polygonCache.get(k)!;
    const corners = prim.ids.map((id) => toWeb(this.finalPoint(id)));
    let normal: Vector = [0, 0, 0];
    corners.forEach((p, n) => {
      const q = corners[(n + 1) % corners.length]!;
      normal = add(normal, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
    });
    // Coincident points (the surface through grid nodes) give zero-area faces with no normal.
    const result = len(normal) < 1e-12 ? null : { corners, vertices: prim.ids, normal: normalize(normal) };
    this.polygonCache.set(k, result);
    return result;
  }

  private star(id: string): Polygon[] {
    return this.starPrims(id).map((p) => this.polygon(p)).filter((p): p is Polygon => p !== null);
  }

  private readonly leafPolygonCache = new Map<string, Polygon[]>();

  /** Polygons of the edges owned by cells of one leaf. */
  private leafPolygons(origin: Index): Polygon[] {
    const k = key(origin);
    let out = this.leafPolygonCache.get(k);
    if (out) return out;
    out = [];
    if (this.leafCanHaveSurface(origin)) {
      const seen = new Set<Prim>();
      for (let i = 0; i < LEAF; i += 1) for (let j = 0; j < LEAF; j += 1) for (let kk = 0; kk < LEAF; kk += 1) {
        const n: Index = [origin[0] + i, origin[1] + j, origin[2] + kk];
        for (const axis of [0, 1, 2] as const) {
          const p = this.prim(n, axis);
          if (!p || seen.has(p)) continue;
          seen.add(p);
          const polygon = this.polygon(p);
          if (polygon) out.push(polygon);
        }
      }
    }
    this.leafPolygonCache.set(k, out);
    return out;
  }

  private polygonsNear(point: Vector): Polygon[] {
    const h = this.voxel;
    const b: Index = [Math.floor(point[0] / h), Math.floor(-point[2] / h), Math.floor(point[1] / h)];
    const origin = this.leafOf(b);
    // A polygon's points lie in the leaf that owns its edge or the leaf below it, so polygons
    // near b come from b's leaf and the next one up, plus the outer neighbours when b sits
    // within two cells of a leaf face.
    const offsets = [0, 1, 2].map((axis) => {
      const local = b[axis]! - origin[axis]!;
      return [...(local < 2 ? [-1] : []), 0, 1, ...(local >= LEAF - 2 ? [2] : [])];
    });
    const out: Polygon[] = [];
    for (const i of offsets[0]!) for (const j of offsets[1]!) for (const k of offsets[2]!) {
      out.push(...this.leafPolygons([origin[0] + i * LEAF, origin[1] + j * LEAF, origin[2] + k * LEAF]));
    }
    return out;
  }
}

/** AdaptivePrimBuilder: a quad, a triangle where two corners share a point, or nothing. */
function collapse(v: string[], reverse: boolean): Prim | null {
  const [a, b, c, d] = v as [string, string, string, string];
  const tri = (x: string, y: string, z: string): Prim => ({ ids: reverse ? [z, y, x] : [x, y, z], triangle: true });
  if (a !== b && a !== c && a !== d && b !== c && b !== d && c !== d) return { ids: reverse ? [d, c, b, a] : [a, b, c, d], triangle: false };
  if (a === d && b !== c && b !== a && c !== a) return tri(a, b, c);
  if (b === c && a !== d && a !== b && d !== b) return tri(a, b, d);
  if (a === b && c !== d && c !== a && d !== a) return tri(a, c, d);
  if (c === d && a !== b && a !== c && b !== c) return tri(a, b, c);
  return null;
}

/** Blender triangulates quads along the 0-2 diagonal. */
function fan(corners: Vector[]): [Vector, Vector, Vector][] {
  const out: [Vector, Vector, Vector][] = [];
  for (let k = 1; k < corners.length - 1; k += 1) out.push([corners[0]!, corners[k]!, corners[k + 1]!]);
  return out;
}

function toWeb([x, y, z]: Vector): Vector {
  return [x, z, -y];
}

/**
 * Signed distance to a closed mesh (negative inside): nearest triangle through a bounding
 * volume hierarchy, sign from the parity of an upward ray. Allocation-free on typed arrays.
 */
class SignedDistance {
  private readonly tris: Float64Array;
  private readonly order: Int32Array;
  /** Per node: min xyz, max xyz. */
  private readonly boxes: Float64Array;
  /** Per node: left child (-1 for a leaf), right child, first triangle, triangle count. */
  private readonly links: Int32Array;
  private readonly stack = new Int32Array(256);

  constructor(model: TriangleMesh) {
    const count = model.indices.length / 3;
    this.tris = new Float64Array(count * 9);
    for (let face = 0; face < count; face += 1) {
      for (let k = 0; k < 3; k += 1) {
        const i = model.indices[face * 3 + k]! * 3;
        this.tris[face * 9 + k * 3] = model.positions[i]!;
        this.tris[face * 9 + k * 3 + 1] = model.positions[i + 1]!;
        this.tris[face * 9 + k * 3 + 2] = model.positions[i + 2]!;
      }
    }
    const t = this.tris;
    const centroid = (f: number, axis: number) => (t[f * 9 + axis]! + t[f * 9 + 3 + axis]! + t[f * 9 + 6 + axis]!) / 3;
    const boxes: number[] = [];
    const links: number[] = [];
    const order: number[] = [];
    const build = (list: number[]): number => {
      const node = links.length / 4;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const f of list) for (let v = 0; v < 3; v += 1) for (let axis = 0; axis < 3; axis += 1) {
        const value = t[f * 9 + v * 3 + axis]!;
        if (value < min[axis]!) min[axis] = value;
        if (value > max[axis]!) max[axis] = value;
      }
      boxes.push(...min, ...max);
      links.push(-1, -1, order.length, list.length);
      if (list.length <= 4) {
        order.push(...list);
        return node;
      }
      let axis = 0;
      let spread = -1;
      for (let a = 0; a < 3; a += 1) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const f of list) {
          const c = centroid(f, a);
          if (c < lo) lo = c;
          if (c > hi) hi = c;
        }
        if (hi - lo > spread) {
          spread = hi - lo;
          axis = a;
        }
      }
      list.sort((x, y) => centroid(x, axis) - centroid(y, axis));
      const half = list.length >> 1;
      const left = build(list.slice(0, half));
      const right = build(list.slice(half));
      links[node * 4] = left;
      links[node * 4 + 1] = right;
      links[node * 4 + 3] = 0;
      return node;
    };
    if (count > 0) build([...Array(count).keys()]);
    this.boxes = Float64Array.from(boxes);
    this.links = Int32Array.from(links);
    this.order = Int32Array.from(order);
  }

  /** Signed distance, with the magnitude capped at `cap` (beyond it only the sign is exact). */
  at(point: Vector, cap = Infinity): number {
    if (this.links.length === 0) return cap;
    const [px, py, pz] = point;
    let best = cap * cap;
    const stack = this.stack;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const node = stack[--top]!;
      if (this.boxDistanceSq(node, px, py, pz) >= best) continue;
      const left = this.links[node * 4]!;
      if (left < 0) {
        const start = this.links[node * 4 + 2]!;
        const n = this.links[node * 4 + 3]!;
        for (let k = 0; k < n; k += 1) {
          const d = triangleDistanceSq(this.tris, this.order[start + k]! * 9, px, py, pz);
          if (d < best) best = d;
        }
        continue;
      }
      const right = this.links[node * 4 + 1]!;
      if (this.boxDistanceSq(left, px, py, pz) < this.boxDistanceSq(right, px, py, pz)) {
        stack[top++] = right;
        stack[top++] = left;
      } else {
        stack[top++] = left;
        stack[top++] = right;
      }
    }
    const distance = Math.sqrt(best);
    return this.inside(px, py, pz) ? -distance : distance;
  }

  /** Closest point on the mesh surface (Sample Nearest Surface). */
  nearestPoint(point: Vector): Vector {
    const [px, py, pz] = point;
    let best = Infinity;
    let bestOffset = -1;
    const stack = this.stack;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const node = stack[--top]!;
      if (this.boxDistanceSq(node, px, py, pz) >= best) continue;
      const left = this.links[node * 4]!;
      if (left < 0) {
        const start = this.links[node * 4 + 2]!;
        const n = this.links[node * 4 + 3]!;
        for (let k = 0; k < n; k += 1) {
          const o = this.order[start + k]! * 9;
          const d = triangleDistanceSq(this.tris, o, px, py, pz);
          if (d < best) {
            best = d;
            bestOffset = o;
          }
        }
        continue;
      }
      const right = this.links[node * 4 + 1]!;
      if (this.boxDistanceSq(left, px, py, pz) < this.boxDistanceSq(right, px, py, pz)) {
        stack[top++] = right;
        stack[top++] = left;
      } else {
        stack[top++] = left;
        stack[top++] = right;
      }
    }
    if (bestOffset < 0) return point;
    const t = this.tris;
    const o = bestOffset;
    return closestOnTriangle(point, [t[o]!, t[o + 1]!, t[o + 2]!], [t[o + 3]!, t[o + 4]!, t[o + 5]!], [t[o + 6]!, t[o + 7]!, t[o + 8]!]);
  }

  private boxDistanceSq(node: number, x: number, y: number, z: number): number {
    const b = node * 6;
    const dx = Math.max(this.boxes[b]! - x, 0, x - this.boxes[b + 3]!);
    const dy = Math.max(this.boxes[b + 1]! - y, 0, y - this.boxes[b + 4]!);
    const dz = Math.max(this.boxes[b + 2]! - z, 0, z - this.boxes[b + 5]!);
    return dx * dx + dy * dy + dz * dz;
  }

  private inside(x0: number, y: number, z0: number): boolean {
    // Nudge the ray off grid-aligned vertices and edges, where parity would double count.
    const x = x0 + 1.37e-6;
    const z = z0 + 0.71e-6;
    const t = this.tris;
    let crossings = 0;
    const stack = this.stack;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const node = stack[--top]!;
      const b = node * 6;
      if (x < this.boxes[b]! || x > this.boxes[b + 3]! || z < this.boxes[b + 2]! || z > this.boxes[b + 5]! || this.boxes[b + 4]! <= y) continue;
      const left = this.links[node * 4]!;
      if (left >= 0) {
        stack[top++] = left;
        stack[top++] = this.links[node * 4 + 1]!;
        continue;
      }
      const start = this.links[node * 4 + 2]!;
      const n = this.links[node * 4 + 3]!;
      for (let k = 0; k < n; k += 1) {
        const o = this.order[start + k]! * 9;
        const ax = t[o]!, ay = t[o + 1]!, az = t[o + 2]!;
        const bx = t[o + 3]!, by = t[o + 4]!, bz = t[o + 5]!;
        const cx = t[o + 6]!, cy = t[o + 7]!, cz = t[o + 8]!;
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-12) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 <= 0) continue;
        if (l1 * ay + l2 * by + l3 * cy > y) crossings += 1;
      }
    }
    return crossings % 2 === 1;
  }
}

/** Nearest-surface queries on a mesh (bounding volume hierarchy). */
export class SurfaceQuery {
  private readonly bvh: SignedDistance;
  constructor(model: TriangleMesh) {
    this.bvh = new SignedDistance(model);
  }

  /** Closest point on the surface to `point`. */
  nearest(point: Vector): Vector {
    return this.bvh.nearestPoint(point);
  }
}

function closestOnTriangle(p: Vector, a: Vector, b: Vector, c: Vector): Vector {
  // Ericson, Real-Time Collision Detection 5.1.5.
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denominator = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denominator), scale(ac, vc * denominator)));
}

/** Squared distance from (px, py, pz) to the triangle at offset o of a flat array (Ericson 5.1.5). */
function triangleDistanceSq(t: Float64Array, o: number, px: number, py: number, pz: number): number {
  const ax = t[o]!, ay = t[o + 1]!, az = t[o + 2]!;
  const abx = t[o + 3]! - ax, aby = t[o + 4]! - ay, abz = t[o + 5]! - az;
  const acx = t[o + 6]! - ax, acy = t[o + 7]! - ay, acz = t[o + 8]! - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const x = apx - abx * v, y = apy - aby * v, z = apz - abz * v;
    return x * x + y * y + z * z;
  }
  const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const x = apx - acx * w, y = apy - acy * w, z = apz - acz * w;
    return x * x + y * y + z * z;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const x = bpx - (acx - abx) * w, y = bpy - (acy - aby) * w, z = bpz - (acz - abz) * w;
    return x * x + y * y + z * z;
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  const x = apx - abx * v - acx * w, y = apy - aby * v - acy * w, z = apz - abz * v - acz * w;
  return x * x + y * y + z * z;
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
function cross(a: Vector, b: Vector): Vector { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(v: Vector): number { return Math.hypot(v[0], v[1], v[2]); }
function normalize(v: Vector): Vector {
  const length = len(v);
  return length === 0 ? [0, -1, 0] : [v[0] / length, v[1] / length, v[2] / length];
}
