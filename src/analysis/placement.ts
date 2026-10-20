import { RemeshTarget, SurfaceQuery } from '../supports/remesh';
import { edgeAnchors } from './edgeAnchors';
import { mergeByDistance } from './kdtree';
import { classifyDownwardFaces, partitionRegions } from './mesh';
import type {
  PlacementResult,
  PlacementSettings,
  SupportPoint,
  SupportPointSource,
  ProgressCallback,
  TriangleMesh,
} from './types';

type Vector = [number, number, number];

interface Candidate {
  regionId: number;
  position: Vector;
  normal: Vector;
  source: SupportPointSource;
}

/**
 * Automatic contacts as SLASG_VertexScatter_Mixo builds them, in its stream order and without
 * cross-class de-duplication:
 * 1. Poisson points on overhang faces (Distribute Points on Faces, POISSON: Distance Min =
 *    Spacing, Density Max = (1/Spacing)^4, seed 0);
 * 2. island minima (local-minimum vertices, merged within Spacing), which get vertical necks;
 * 3. Resin UV edge anchors (exact port of `rebuild_edge_candidates`).
 * Blender samples the Poisson field and minima on an OpenVDB remesh of the model; the web uses
 * the exact model, so those two streams match Blender statistically, not point for point.
 */
export function generatePlacement(mesh: TriangleMesh, settings: PlacementSettings, onProgress?: ProgressCallback): PlacementResult {
  validateSettings(settings);
  onProgress?.(0, 'Finding overhangs');
  const downward = classifyDownwardFaces(mesh, settings.overhangAngleDegrees);
  const regions = partitionRegions(mesh, downward);
  const regionOf = new Map<number, number>();
  for (const region of regions) for (const face of region.faceIndices) regionOf.set(face, region.id);

  const candidates: Candidate[] = [];
  // The Poisson field and the minima come from R, the model remeshed at Spacing / 4; like
  // MIXO_ManualPoints, their points are then snapped onto the model's surface.
  const needsRemesh = settings.includeDownward !== false || settings.includeIslands;
  // A signed distance needs a closed surface; for open or broken meshes the same rules run on
  // the model itself.
  const remesh = !needsRemesh ? undefined : isClosed(mesh)
    ? new RemeshTarget(mesh, 0, settings.spacing / 4).fullMesh((fraction) => onProgress?.(0.1 + 0.4 * fraction, 'Remeshing the model'))
    : exactAsRemesh(mesh);
  const surface = needsRemesh ? new SurfaceQuery(mesh) : undefined;
  const snap = (candidate: Candidate): Candidate => ({ ...candidate, position: surface!.nearest(candidate.position) });
  onProgress?.(0.5, 'Scattering contacts');
  if (remesh && settings.includeDownward !== false) candidates.push(...poissonOnRemesh(remesh, settings).map(snap));
  onProgress?.(0.65, 'Finding lowest points');
  if (remesh && settings.includeIslands) candidates.push(...minimaOnRemesh(remesh, settings).map(snap));
  onProgress?.(0.8, 'Reinforcing edges');
  if (settings.reinforceEdges !== false) {
    for (const anchor of edgeAnchors(mesh, {
      overhangAngleDegrees: settings.overhangAngleDegrees,
      spacing: settings.spacing,
      radius: settings.edgeInset,
      facingDown: settings.includeDownward !== false,
    })) {
      candidates.push({ regionId: -1, position: anchor.position, normal: anchor.normal, source: anchor.source });
    }
  }

  onProgress?.(0.95, 'Collecting contacts');
  const seen = new Set<string>();
  const points: SupportPoint[] = [];
  for (const candidate of candidates) {
    const id = positionId(candidate.position);
    if (seen.has(id)) continue;
    seen.add(id);
    points.push({ ...candidate, id });
  }
  return {
    points,
    regions,
    contactPositions: new Float32Array(points.flatMap((point) => point.position)),
    contactNormals: new Float32Array(points.flatMap((point) => point.normal)),
  };
}

/**
 * Final contacts for one unit, as MIXO_ManualPoints builds them: automatic contacts plus manual
 * additions, then every contact within `eraseRadius` of a removal marker is deleted. Markers
 * are the removed automatic IDs, which encode their positions; with no radius only the exact
 * IDs are hidden.
 */
export function composeContacts(
  auto: readonly SupportPoint[],
  manual: readonly SupportPoint[],
  suppressed: readonly string[],
  eraseRadius = 0,
): SupportPoint[] {
  const hidden = new Set(suppressed);
  const markers = suppressed.map(positionFromId).filter((point): point is Vector => point !== undefined);
  const erased = (point: SupportPoint) => hidden.has(point.id)
    || (eraseRadius > 0 && markers.some((marker) => distance(marker, point.position) < eraseRadius));
  return [...auto, ...manual].filter((point) => !erased(point));
}

/** Position encoded in an automatic contact ID (0.01 mm grid), if it is one. */
export function positionFromId(id: string): Vector | undefined {
  const match = /^auto-(-?\d+)_(-?\d+)_(-?\d+)$/.exec(id);
  return match ? [Number(match[1]) / 100, Number(match[2]) / 100, Number(match[3]) / 100] : undefined;
}

/** Worker results are accepted only for the newest generation request of their unit. */
export function isCurrentPlacement(
  latest: Readonly<Record<string, number>>,
  response: { unitId: string; revision: number },
): boolean {
  return latest[response.unitId] === response.revision;
}

function validateSettings(settings: PlacementSettings): void {
  if (!Number.isFinite(settings.spacing) || settings.spacing <= 0) throw new RangeError('spacing must be greater than zero');
  if (!Number.isFinite(settings.edgeInset) || settings.edgeInset < 0) throw new RangeError('edgeInset must be non-negative');
  if (!Number.isFinite(settings.sharpEdgeAngleDegrees) || settings.sharpEdgeAngleDegrees < 0 || settings.sharpEdgeAngleDegrees > 180) {
    throw new RangeError('sharpEdgeAngleDegrees must be between 0 and 180');
  }
}

/**
 * Blender `Distribute Points on Faces` (POISSON) on faces within Overhang Angle of straight down:
 * each triangle draws floor(area x density + rng) points with Blender's per-triangle seeded RNG,
 * then points closer than Distance Min to an earlier kept point are eliminated in order.
 */
type Remesh = ReturnType<RemeshTarget['fullMesh']>;

/** Every edge (vertices welded by position) is shared by exactly two faces. */
function isClosed(mesh: TriangleMesh): boolean {
  const ids = new Map<string, number>();
  const weld = (index: number) => {
    const key = pointAt(mesh, index).map((v) => Math.round(v * 1e5)).join(',');
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const edges = new Map<string, number>();
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    const v = [0, 1, 2].map((k) => weld(mesh.indices[face * 3 + k]!));
    for (let k = 0; k < 3; k += 1) {
      const a = v[k]!;
      const b = v[(k + 1) % 3]!;
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return edges.size > 0 && [...edges.values()].every((count) => count === 2);
}

/** The model in the remesh's shape (vertices, faces, face normals). */
function exactAsRemesh(mesh: TriangleMesh): Remesh {
  const vertices = Array.from({ length: mesh.positions.length / 3 }, (_, i) => pointAt(mesh, i));
  const faces = Array.from({ length: mesh.indices.length / 3 }, (_, face) => [0, 1, 2].map((k) => mesh.indices[face * 3 + k]!));
  const normals = faces.map(([a, b, c]) => {
    const crossed = cross(subtract(vertices[b!]!, vertices[a!]!), subtract(vertices[c!]!, vertices[a!]!));
    return Math.hypot(...crossed) === 0 ? null : normalize(crossed);
  });
  return { vertices, faces, normals };
}

/**
 * Distribute Points on Faces (POISSON) on the overhang faces of R (true normal within Overhang
 * Angle of straight down), triangle by triangle in Blender's order: quads split along 0-2,
 * each triangle seeded with hash(triangle index, 0), Density Max = (1/Spacing)^4; then every
 * point within Spacing of an earlier kept point is eliminated.
 */
function poissonOnRemesh(remesh: Remesh, settings: PlacementSettings): Candidate[] {
  const spacing = settings.spacing;
  const density = (1 / spacing) ** 4;
  const limit = settings.overhangAngleDegrees * Math.PI / 180;
  const raw: Candidate[] = [];
  let triangle = 0;
  remesh.faces.forEach((face, f) => {
    const normal = remesh.normals[f];
    if (!normal || Math.acos(Math.max(-1, Math.min(1, -normal[1]))) > limit) return;
    for (let k = 1; k < face.length - 1; k += 1) {
      const [a, b, c] = [face[0]!, face[k]!, face[k + 1]!].map((v) => remesh.vertices[v]!) as [Vector, Vector, Vector];
      const area = Math.hypot(...cross(subtract(b, a), subtract(c, a))) / 2;
      const rng = new BlenderRng(blenderHash(triangle, 0));
      triangle += 1;
      const amount = area * density;
      const count = Math.floor(amount) + ((amount - Math.floor(amount)) > rng.float() ? 1 : 0);
      for (let point = 0; point < count; point += 1) {
        let r1 = rng.float();
        let r2 = rng.float();
        if (r1 + r2 > 1) {
          r1 = 1 - r1;
          r2 = 1 - r2;
        }
        raw.push({ regionId: -1, position: add(add(scale(a, r1), scale(b, r2)), scale(c, 1 - r1 - r2)), normal, source: 'interior' });
      }
    }
  });
  const kept: Candidate[] = [];
  const grid = new SpatialHash(spacing);
  const eliminated = new Array<boolean>(raw.length).fill(false);
  raw.forEach((point, index) => grid.add(point.position, index));
  raw.forEach((point, index) => {
    if (eliminated[index]) return;
    kept.push(point);
    for (const other of grid.near(point.position, spacing)) if (other !== index) eliminated[other] = true;
  });
  return kept;
}

/**
 * Island minima on R: vertices whose lowest adjacent edge (by midpoint height) is not below
 * them. Merge by Distance (Spacing; Blender's KD-tree, so ties resolve alike) clusters them
 * in R vertex order at the mean position, each cluster snaps to the nearest unmerged minimum, and a minimum is dropped when
 * the true normal of its nearest R vertex leans more than Overhang Angle from straight down.
 */
function minimaOnRemesh(remesh: Remesh, settings: PlacementSettings): Candidate[] {
  const count = remesh.vertices.length;
  const lowest = new Float64Array(count).fill(Infinity);
  const normals = new Float64Array(count * 3);
  remesh.faces.forEach((face, f) => {
    const n = face.length;
    const normal = remesh.normals[f];
    face.forEach((v, k) => {
      const w = face[(k + 1) % n]!;
      const p = remesh.vertices[v]!;
      const q = remesh.vertices[w]!;
      const midpoint = (p[1] + q[1]) / 2;
      if (midpoint < lowest[v]!) lowest[v] = midpoint;
      if (midpoint < lowest[w]!) lowest[w] = midpoint;
      if (!normal) return;
      // Blender vertex normal: face normals weighted by the corner angle.
      const e1 = subtract(remesh.vertices[face[(k + n - 1) % n]!]!, p);
      const e2 = subtract(q, p);
      const l1 = Math.hypot(...e1);
      const l2 = Math.hypot(...e2);
      if (l1 === 0 || l2 === 0) return;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(e1, e2) / (l1 * l2))));
      for (let axis = 0; axis < 3; axis += 1) normals[v * 3 + axis] += normal[axis]! * angle;
    });
  });
  const candidates: number[] = [];
  for (let v = 0; v < count; v += 1) if (lowest[v]! !== Infinity && !(lowest[v]! < remesh.vertices[v]![1])) candidates.push(v);
  const points = candidates.map((v) => remesh.vertices[v]!);
  const merged = mergeByDistance(points, settings.spacing)
    .map((cluster) => scale(cluster.reduce<Vector>((sum, k) => add(sum, points[k]!), [0, 0, 0]), 1 / cluster.length));
  const limit = settings.overhangAngleDegrees * Math.PI / 180;
  const nearestOf = (point: Vector, list: readonly number[]) => list.reduce((best, v) => (distance(remesh.vertices[v]!, point) < distance(remesh.vertices[best]!, point) ? v : best));
  const all = [...Array(count).keys()];
  const minima: Candidate[] = [];
  for (const centre of merged) {
    const position = remesh.vertices[nearestOf(centre, candidates)]!;
    const near = nearestOf(position, all);
    const normal = normalize([normals[near * 3]!, normals[near * 3 + 1]!, normals[near * 3 + 2]!]);
    if (Math.acos(Math.max(-1, Math.min(1, -normal[1]))) > limit) continue;
    minima.push({ regionId: -1, position, normal: [0, -1, 0], source: 'island' });
  }
  return minima;
}

/**
 * Blender `RandomNumberGenerator` (drand48-style LCG) seeded per triangle, as used by
 * `Distribute Points on Faces`.
 */
class BlenderRng {
  private state: bigint;
  constructor(seed: number) {
    this.state = (BigInt(seed >>> 0) << 16n) | 0x330En;
  }
  float(): number {
    this.state = (0x5DEECE66Dn * this.state + 0xBn) & 0xFFFFFFFFFFFFn;
    return Number(this.state >> 17n) / 0x80000000;
  }
}

/** Blender `noise::hash(kx, ky)`: Jenkins lookup3 final mix. */
function blenderHash(kx: number, ky: number): number {
  const rot = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  let a = (0xdeadbeef + (2 << 2) + 13) >>> 0;
  let b = a;
  let c = a;
  b = (b + ky) >>> 0;
  a = (a + kx) >>> 0;
  c = ((c ^ b) - rot(b, 14)) >>> 0;
  a = ((a ^ c) - rot(c, 11)) >>> 0;
  b = ((b ^ a) - rot(a, 25)) >>> 0;
  c = ((c ^ b) - rot(b, 16)) >>> 0;
  a = ((a ^ c) - rot(c, 4)) >>> 0;
  b = ((b ^ a) - rot(a, 14)) >>> 0;
  c = ((c ^ b) - rot(b, 24)) >>> 0;
  return c;
}

class SpatialHash {
  private cells = new Map<string, number[]>();
  private points: Vector[] = [];
  constructor(private size: number) {}
  private key(x: number, y: number, z: number): string { return `${x}|${y}|${z}`; }
  add(point: Vector, index: number): void {
    this.points[index] = point;
    const key = this.key(Math.floor(point[0] / this.size), Math.floor(point[1] / this.size), Math.floor(point[2] / this.size));
    const cell = this.cells.get(key);
    if (cell) cell.push(index); else this.cells.set(key, [index]);
  }
  near(point: Vector, radius: number): number[] {
    const [cx, cy, cz] = point.map((value) => Math.floor(value / this.size));
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const index of this.cells.get(this.key(cx! + dx, cy! + dy, cz! + dz)) ?? []) {
        if (distance(point, this.points[index]!) <= radius) out.push(index);
      }
    }
    return out;
  }
}

/**
 * Automatic IDs encode the contact position (0.01 mm grid), like Blender's removed-point
 * markers: a suppression keeps hiding the same spot after any regeneration and simply
 * stops matching when that spot is no longer sampled.
 */
function positionId(position: Vector): string {
  return `auto-${position.map((value) => Math.round(value * 100)).join('_')}`;
}

function pointAt(mesh: TriangleMesh, index: number): Vector {
  const offset = index * 3;
  return [mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!];
}

function add(first: Vector, second: Vector): Vector { return [first[0] + second[0], first[1] + second[1], first[2] + second[2]]; }
function subtract(first: Vector, second: Vector): Vector { return [first[0] - second[0], first[1] - second[1], first[2] - second[2]]; }
function scale(vector: Vector, amount: number): Vector { return [vector[0] * amount, vector[1] * amount, vector[2] * amount]; }
function dot(first: Vector, second: Vector): number { return first[0] * second[0] + first[1] * second[1] + first[2] * second[2]; }
function cross(first: Vector, second: Vector): Vector { return [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]]; }
function distance(first: Vector, second: Vector): number { return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]); }
function normalize(vector: Vector): Vector { const length = Math.hypot(...vector); return length === 0 ? [0, 0, 0] : [vector[0] / length, vector[1] / length, vector[2] / length]; }
