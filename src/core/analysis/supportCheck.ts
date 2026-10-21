import { faceOverhangLimit } from './mesh';
import type { ProgressCallback, TriangleMesh } from './types';
import { distance, type Vector } from '../vec3';

/** A spot that would print without support: a new island, or overhang area far from contacts. */
export interface SupportProblem {
  kind: 'island' | 'overhang';
  /** Centre of the spot, in the frame of the checked mesh (Y up). */
  position: Vector;
  /** Unsupported overhang area in mm² (0 for a lone island point). */
  area: number;
}

export interface CheckSettings {
  overhangAngleDegrees: number;
  spacing: number;
}

/** A contact covers overhang within this many Support spacings. */
export const COVER_FACTOR = 1.5;
/** Most problems reported; the largest come first. */
const MAX_PROBLEMS = 50;
/** Overhang samples are capped so huge models still check quickly. */
const MAX_SAMPLES = 200_000;

/**
 * Finds what the contacts leave unsupported, the way a resin print fails:
 * - islands: downward-facing local lowest points (a flat bottom counts once) with no contact
 *   within one Support spacing; each would start printing in mid-air;
 * - overhangs: faces steeper than Overhang angle from straight down whose surface lies more than
 *   COVER_FACTOR x Support spacing from every contact.
 * Spots are clustered (2 x Support spacing) and slivers below a quarter spacing² are ignored.
 */
export function checkSupports(mesh: TriangleMesh, contacts: readonly Vector[], settings: CheckSettings, onProgress?: ProgressCallback): SupportProblem[] {
  const { positions, indices } = mesh;
  const spacing = settings.spacing;
  const vertexCount = positions.length / 3;
  const contactsNear = new SpatialHash(spacing * COVER_FACTOR);
  contacts.forEach((contact) => contactsNear.add(contact));
  const covered = (point: Vector, radius: number) => contactsNear.any(point, radius);

  // Vertex normals (area weighted) and neighbours (CSR arrays keep memory flat on big meshes).
  onProgress?.(0.05, 'Finding unsupported islands');
  const normals = new Float32Array(positions.length);
  const degree = new Int32Array(vertexCount + 1);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const n = faceNormal(positions, a, b, c);
    for (const v of [a, b, c]) {
      normals[v * 3] += n[0];
      normals[v * 3 + 1] += n[1];
      normals[v * 3 + 2] += n[2];
      degree[v + 1] += 2;
    }
  }
  for (let v = 0; v < vertexCount; v += 1) degree[v + 1] += degree[v]!;
  const neighbours = new Int32Array(degree[vertexCount]!);
  const fill = degree.slice(0, vertexCount);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    neighbours[fill[a]!++] = b; neighbours[fill[a]!++] = c;
    neighbours[fill[b]!++] = c; neighbours[fill[b]!++] = a;
    neighbours[fill[c]!++] = a; neighbours[fill[c]!++] = b;
  }

  const spots: { kind: SupportProblem['kind']; position: Vector; area: number }[] = [];
  // Downward-facing vertices joined into plateaus of equal height (a flat bottom is one).
  const epsilon = 1e-5;
  const down = new Uint8Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    const ny = normals[v * 3 + 1]!;
    const length = Math.hypot(normals[v * 3]!, ny, normals[v * 3 + 2]!);
    down[v] = length > 0 && ny / length <= -0.3 ? 1 : 0;
  }
  const parent = new Int32Array(vertexCount).map((_, v) => v);
  const root = (v: number): number => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]!]!;
    return v;
  };
  for (let v = 0; v < vertexCount; v += 1) {
    if (!down[v]) continue;
    for (let k = degree[v]!; k < degree[v + 1]!; k += 1) {
      const w = neighbours[k]!;
      if (down[w] && Math.abs(positions[w * 3 + 1]! - positions[v * 3 + 1]!) <= epsilon) parent[root(w)] = root(v);
    }
  }
  // A plateau is a lowest point when none of its vertices has a lower neighbour; it is an
  // island when no contact lies within one Support spacing of any of its vertices.
  const plateaus = new Map<number, { lower: boolean; covered: boolean; sum: Vector; count: number }>();
  for (let v = 0; v < vertexCount; v += 1) {
    if (!down[v]) continue;
    const key = root(v);
    const plateau = plateaus.get(key) ?? { lower: false, covered: false, sum: [0, 0, 0], count: 0 };
    const point: Vector = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
    for (let k = degree[v]!; k < degree[v + 1]! && !plateau.lower; k += 1) {
      if (positions[neighbours[k]! * 3 + 1]! < point[1] - epsilon) plateau.lower = true;
    }
    if (!plateau.covered && !plateau.lower && covered(point, spacing)) plateau.covered = true;
    plateau.sum = [plateau.sum[0] + point[0], plateau.sum[1] + point[1], plateau.sum[2] + point[2]];
    plateau.count += 1;
    plateaus.set(key, plateau);
  }
  for (const plateau of plateaus.values()) {
    if (plateau.lower || plateau.covered) continue;
    spots.push({ kind: 'island', position: plateau.sum.map((value) => value / plateau.count) as Vector, area: 0 });
  }

  // Overhang coverage on a lattice of about (spacing / 2)² per sample.
  onProgress?.(0.4, 'Checking overhang coverage');
  const limit = Math.cos(faceOverhangLimit(settings.overhangAngleDegrees) * Math.PI / 180);
  let overhangArea = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const n = faceNormal(positions, indices[t]!, indices[t + 1]!, indices[t + 2]!);
    const area = Math.hypot(...n) / 2;
    if (area > 0 && -n[1] / (2 * area) >= limit) overhangArea += area;
  }
  const cell = Math.max((spacing / 2) ** 2, overhangArea / MAX_SAMPLES);
  const triangleCount = indices.length / 3;
  for (let t = 0; t < indices.length; t += 3) {
    if ((t / 3) % 5000 === 0) onProgress?.(0.4 + 0.5 * (t / 3) / triangleCount, 'Checking overhang coverage');
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const n = faceNormal(positions, a, b, c);
    const area = Math.hypot(...n) / 2;
    if (area === 0 || -n[1] / (2 * area) < limit) continue;
    const steps = Math.max(1, Math.ceil(Math.sqrt(area / cell)));
    const share = area / (steps * steps);
    for (let i = 0; i < steps; i += 1) {
      for (let j = 0; j < steps - i; j += 1) {
        // Centres of the small triangles of a steps x steps subdivision (upright ones).
        const u = (i + 1 / 3) / steps;
        const w = (j + 1 / 3) / steps;
        const point = barycentric(positions, a, b, c, u, w);
        if (!covered(point, spacing * COVER_FACTOR)) spots.push({ kind: 'overhang', position: point, area: share * 2 });
      }
    }
  }

  onProgress?.(0.95, 'Grouping problems');
  // Spots in touching cells (2 x Support spacing) form one problem: one cleared patch is one entry.
  const size = spacing * 2;
  const cells = new Map<string, number[]>();
  spots.forEach((spot, index) => {
    const key = spot.position.map((value) => Math.floor(value / size)).join(',');
    const list = cells.get(key);
    if (list) list.push(index); else cells.set(key, [index]);
  });
  const seen = new Set<string>();
  const groups: number[][] = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const group: number[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const key = stack.pop()!;
      group.push(...cells.get(key)!);
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
        const next = `${x + dx},${y + dy},${z + dz}`;
        if (cells.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    groups.push(group);
  }
  const problems = groups.map((group) => {
    const members = group.map((index) => spots[index]!);
    const island = members.find((spot) => spot.kind === 'island');
    const area = members.reduce((sum, spot) => sum + spot.area, 0);
    const centre = members.reduce<Vector>((sum, spot) => [sum[0] + spot.position[0], sum[1] + spot.position[1], sum[2] + spot.position[2]], [0, 0, 0]).map((value) => value / members.length) as Vector;
    // Mark an island where it is, an overhang at its spot nearest the middle (on the surface).
    const anchor = island ?? members.reduce((best, spot) => (distance(spot.position, centre) < distance(best.position, centre) ? spot : best));
    return { kind: island ? 'island' as const : 'overhang' as const, position: anchor.position, area };
  })
    .filter((problem) => problem.kind === 'island' || problem.area >= spacing * spacing / 4)
    .sort((p, q) => (p.kind === q.kind ? q.area - p.area : p.kind === 'island' ? -1 : 1))
    .slice(0, MAX_PROBLEMS);
  onProgress?.(1, 'Done');
  return problems;
}


function faceNormal(p: ArrayLike<number>, a: number, b: number, c: number): Vector {
  const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
  const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function barycentric(p: ArrayLike<number>, a: number, b: number, c: number, u: number, w: number): Vector {
  const s = 1 - u - w;
  return [0, 1, 2].map((axis) => p[a * 3 + axis]! * s + p[b * 3 + axis]! * u + p[c * 3 + axis]! * w) as Vector;
}

class SpatialHash {
  private readonly cells = new Map<string, Vector[]>();
  constructor(private readonly size: number) {}

  add(point: Vector): void {
    const key = this.key(point);
    const list = this.cells.get(key);
    if (list) list.push(point); else this.cells.set(key, [point]);
  }

  any(point: Vector, radius: number): boolean {
    const reach = Math.ceil(radius / this.size);
    const [cx, cy, cz] = point.map((value) => Math.floor(value / this.size));
    for (let x = cx! - reach; x <= cx! + reach; x += 1) for (let y = cy! - reach; y <= cy! + reach; y += 1) for (let z = cz! - reach; z <= cz! + reach; z += 1) {
      for (const other of this.cells.get(`${x},${y},${z}`) ?? []) {
        if (Math.hypot(other[0] - point[0], other[1] - point[1], other[2] - point[2]) <= radius) return true;
      }
    }
    return false;
  }

  private key(point: Vector): string {
    return point.map((value) => Math.floor(value / this.size)).join(',');
  }
}
