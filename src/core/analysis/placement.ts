import { RemeshTarget, SurfaceQuery } from '../supports/remesh';
import { edgeAnchors } from './edgeAnchors';
import { NearestPoint } from './nearestPoint';
import { mergeByDistance } from './mergeByDistance';
import { Drand48, hashPair } from './random';
import { vertexNormals } from './vertexNormals';
import { legacyRidgeMidpoints } from './legacyRidges';
import { classifyDownwardFaces, faceOverhangLimit, partitionRegions } from './mesh';
import type {
  PlacementResult,
  PlacementSettings,
  SupportPoint,
  SupportPointSource,
  ProgressCallback,
  TriangleMesh,
} from './types';
import { add, cross, distance, normalize, scale, subtract, type Vector } from '../vec3';

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
 * 2. island minima (local-minimum vertices, merged within Spacing), which get vertical necks,
 *    joined before the merge by the legacy SDF ridge points while Reinforce overhang edges is off;
 * 3. Resin UV edge anchors (exact port of `rebuild_edge_candidates`, creases sharper than Ridge
 *    angle) while it is on.
 * Blender samples the Poisson field and minima on an OpenVDB remesh of the model; the web uses
 * the exact model, so those two streams match Blender statistically, not point for point.
 */
export function generatePlacement(mesh: TriangleMesh, settings: PlacementSettings, onProgress?: ProgressCallback): PlacementResult {
  validateSettings(settings);
  onProgress?.(0, 'Finding overhangs');
  const downward = classifyDownwardFaces(mesh, faceOverhangLimit(settings.overhangAngleDegrees));
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
      overhangAngleDegrees: faceOverhangLimit(settings.overhangAngleDegrees),
      spacing: settings.spacing,
      radius: settings.edgeInset,
      facingDown: settings.includeDownward !== false,
      ridgeAngleDegrees: settings.sharpEdgeAngleDegrees,
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
 *
 * `deleted` lists exact removals, applied after that and never touching neighbours or manual
 * contacts. An ID that names no automatic contact hides nothing (`remapDeleted` re-keys them
 * when placement lands).
 */
export function composeContacts(
  auto: readonly SupportPoint[],
  manual: readonly SupportPoint[],
  suppressed: readonly string[],
  eraseRadius = 0,
  deleted: readonly string[] = [],
): SupportPoint[] {
  return compose(auto, manual, suppressed, eraseRadius, deleted);
}

/**
 * The `suppressed` and `deleted` IDs that hide at least one contact in `composeContacts` with
 * the same arguments; a removal whose spot is gone (or that was never generated) hides nothing.
 */
export function hidingRemovals(
  auto: readonly SupportPoint[],
  manual: readonly SupportPoint[],
  suppressed: readonly string[],
  eraseRadius = 0,
  deleted: readonly string[] = [],
): Set<string> {
  const hiding = new Set<string>();
  compose(auto, manual, suppressed, eraseRadius, deleted, hiding);
  return hiding;
}

/** `composeContacts`; with `hiding`, also collects every removal ID that hides a contact. */
function compose(
  auto: readonly SupportPoint[],
  manual: readonly SupportPoint[],
  suppressed: readonly string[],
  eraseRadius: number,
  deleted: readonly string[],
  hiding?: Set<string>,
): SupportPoint[] {
  const hidden = new Set(suppressed);
  const markers = suppressed.flatMap((id) => {
    const at = positionFromId(id);
    return at ? [{ id, at }] : [];
  });
  const erased = (point: SupportPoint) => {
    let gone = false;
    if (hidden.has(point.id)) {
      if (!hiding) return true;
      hiding.add(point.id);
      gone = true;
    }
    if (eraseRadius <= 0) return gone;
    for (const marker of markers) {
      if (!(distance(marker.at, point.position) < eraseRadius)) continue;
      if (!hiding) return true;
      hiding.add(marker.id);
      gone = true;
    }
    return gone;
  };
  const exact = new Set(deleted);
  const remainingAuto = auto.filter((point) => {
    if (exact.has(point.id)) {
      hiding?.add(point.id);
      return false;
    }
    return !erased(point);
  });
  return [...remainingAuto, ...manual.filter((point) => !erased(point))];
}

/**
 * Re-keys removed IDs for a fresh placement: an ID that names a new contact stays; one that does
 * not becomes the ID of the nearest still-unclaimed new contact within `matchRadius` of its
 * encoded spot (the spots moved a little); one with no such neighbour is kept, in case a later
 * placement samples that spot again. Both sides are unit-local, so the match is exact afterwards.
 */
export function remapDeleted(deleted: readonly string[], points: readonly SupportPoint[], matchRadius: number): string[] {
  const ids = new Set(points.map((point) => point.id));
  const claimed = new Set(deleted.filter((id) => ids.has(id)));
  const out = new Set<string>();
  for (const id of deleted) {
    if (claimed.has(id)) { out.add(id); continue; }
    const target = positionFromId(id);
    let nearest: SupportPoint | undefined;
    let nearestDistance = matchRadius;
    if (target) {
      for (const point of points) {
        if (claimed.has(point.id)) continue;
        const d = distance(target, point.position);
        if (d < nearestDistance) { nearest = point; nearestDistance = d; }
      }
    }
    if (nearest) claimed.add(nearest.id);
    out.add(nearest ? nearest.id : id);
  }
  return [...out];
}

/** Gives every automatic contact the ID its stored position encodes; `ids` maps each changed old ID to its new one. */
export function rekeyPoints(points: readonly SupportPoint[]): { points: SupportPoint[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const out = points.map((point) => {
    if (!positionFromId(point.id)) return point;
    const id = positionId(point.position);
    if (id === point.id) return point;
    ids.set(point.id, id);
    return { ...point, id };
  });
  return { points: out, ids };
}

/** Position encoded in an automatic contact ID (0.01 mm grid), if it is one. */
export function positionFromId(id: string): Vector | undefined {
  const match = /^auto-(-?\d+)_(-?\d+)_(-?\d+)$/.exec(id);
  return match ? [Number(match[1]) / 100, Number(match[2]) / 100, Number(match[3]) / 100] : undefined;
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
  const limit = faceOverhangLimit(settings.overhangAngleDegrees) * Math.PI / 180;
  const raw: Candidate[] = [];
  let triangle = 0;
  remesh.faces.forEach((face, f) => {
    const normal = remesh.normals[f];
    if (!normal || Math.acos(Math.max(-1, Math.min(1, -normal[1]))) > limit) return;
    for (let k = 1; k < face.length - 1; k += 1) {
      const [a, b, c] = [face[0]!, face[k]!, face[k + 1]!].map((v) => remesh.vertices[v]!) as [Vector, Vector, Vector];
      const area = Math.hypot(...cross(subtract(b, a), subtract(c, a))) / 2;
      const rng = new Drand48(hashPair(triangle, 0));
      triangle += 1;
      const amount = area * density;
      const count = Math.floor(amount) + ((amount - Math.floor(amount)) > rng.next() ? 1 : 0);
      for (let point = 0; point < count; point += 1) {
        let r1 = rng.next();
        let r2 = rng.next();
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
 * Each stage of the island minima on R (checked stage by stage against Resin UV's dumps in
 * tools/blender-parity/minima_stages.json and ridge_stages.json): candidates are vertices whose
 * lowest adjacent edge midpoint is not below them; Merge by Distance (Spacing, points exactly
 * Spacing apart merge) mixes positions in single precision; each merged point snaps to its
 * nearest candidate and samples the nearest R vertex (lowest index wins exact ties); the point
 * is dropped when acos(-normal.z) of that vertex's single-precision true normal exceeds
 * Overhang angle. All of it runs on Blender axes, single precision.
 *
 * With Reinforce overhang edges off, Resin UV's scatter also feeds the legacy SDF ridge points
 * (`legacyRidgeMidpoints`, driven by Ridge angle) into the same stream after the minima, so they
 * are merged, snapped and filtered with them. A kept point whose cluster holds a minimum is
 * vertical (SLASG_Line: Vertical wins over Edge); the others are edge contacts.
 */
export function minimaStages(remesh: Remesh, settings: PlacementSettings): {
  candidates: number[];
  ridgeMidpoints: Vector[];
  candidatePoints: Vector[];
  merged: Vector[];
  snapped: Vector[];
  kept: Vector[];
  keptVertical: boolean[];
  /** Web axes: the true normal of the R vertex each kept point sampled (an edge contact's surface normal). */
  keptNormals: Vector[];
} {
  const f = Math.fround;
  const count = remesh.vertices.length;
  const lowest = new Float64Array(count).fill(Infinity);
  remesh.faces.forEach((face) => {
    face.forEach((v, k) => {
      const w = face[(k + 1) % face.length]!;
      const midpoint = (remesh.vertices[v]![1] + remesh.vertices[w]![1]) / 2;
      if (midpoint < lowest[v]!) lowest[v] = midpoint;
      if (midpoint < lowest[w]!) lowest[w] = midpoint;
    });
  });
  const candidates: number[] = [];
  for (let v = 0; v < count; v += 1) if (lowest[v]! !== Infinity && !(lowest[v]! < remesh.vertices[v]![1])) candidates.push(v);
  // Blender axes (web (x, y, z) = Blender (x, -z, y)), so single-precision results compare
  // directly with Resin UV's dumps.
  const toBlender = ([x, y, z]: Vector): Vector => [x, -z, y];
  const blender = remesh.vertices.map(toBlender);
  const normals = vertexNormals(blender, remesh.faces);
  const ridgeMidpoints = settings.reinforceEdges === false
    ? legacyRidgeMidpoints(blender, remesh.faces, normals, settings.sharpEdgeAngleDegrees, settings.overhangAngleDegrees)
    : [];
  const points = [...candidates.map((v) => blender[v]!), ...ridgeMidpoints];
  const clusters = mergeByDistance(points, settings.spacing);
  const merged = clusterMeans(points, clusters);
  const candidateIndex = new NearestPoint(points);
  const snapped = merged.map((centre) => candidateIndex.nearestHit(centre).co);
  const { keep, nearest } = downwardTest(snapped, blender, normals, settings.overhangAngleDegrees);
  const kept = snapped.filter((_, k) => keep[k]);
  const keptVertical = clusters.filter((_, k) => keep[k]).map((cluster) => cluster.some((index) => index < candidates.length));
  const toWeb = ([x, y, z]: Vector): Vector => [x, z, -y];
  return {
    candidates,
    ridgeMidpoints: ridgeMidpoints.map(toWeb),
    candidatePoints: points.map(toWeb),
    merged: merged.map(toWeb),
    snapped: snapped.map(toWeb),
    kept: kept.map(toWeb),
    keptVertical,
    keptNormals: nearest.filter((_, k) => keep[k]).map((vertex) => toWeb(normals[vertex]!)),
  };
}

/**
 * Mean of each cluster in single precision: every member times 1 / n, summed in ascending
 * index order (Blender axes).
 */
export function clusterMeans(points: readonly Vector[], clusters: readonly (readonly number[])[]): Vector[] {
  const f = Math.fround;
  return clusters.map((cluster) => {
    const weight = f(1 / cluster.length);
    const sum: Vector = [0, 0, 0];
    for (const k of [...cluster].sort((p, q) => p - q)) for (let axis = 0; axis < 3; axis += 1) sum[axis] = f(sum[axis]! + f(points[k]![axis]! * weight));
    return sum;
  });
}

/**
 * Whether each point (Blender axes) faces down enough: the single-precision true normal of
 * its nearest R vertex is within Overhang angle of -Z.
 */
export function downwardMask(points: readonly Vector[], vertices: readonly Vector[], normals: readonly Vector[], overhangAngleDegrees: number): boolean[] {
  return downwardTest(points, vertices, normals, overhangAngleDegrees).keep;
}

/** `downwardMask`, with the nearest R vertex each point sampled (-1 for none). */
function downwardTest(points: readonly Vector[], vertices: readonly Vector[], normals: readonly Vector[], overhangAngleDegrees: number): { keep: boolean[]; nearest: number[] } {
  const f = Math.fround;
  const vertexIndex = new NearestPoint(vertices);
  const limit = f(overhangAngleDegrees * Math.PI / 180);
  const nearest = points.map((point) => vertexIndex.nearest(point));
  const keep = nearest.map((vertex) => {
    if (vertex < 0) return false; // no vertices, or a NaN point
    const down = f(-normals[vertex]![2]);
    const angle = down <= -1 ? f(Math.PI) : down >= 1 ? 0 : f(Math.acos(down));
    return !(angle > limit);
  });
  return { keep, nearest };
}

/** Island minima (vertical contacts) and, with Reinforce overhang edges off, legacy ridge points (edge contacts). */
function minimaOnRemesh(remesh: Remesh, settings: PlacementSettings): Candidate[] {
  const stages = minimaStages(remesh, settings);
  // Vertical contacts point straight down; edge contacts carry their surface normal, which a
  // Low Poly preview (no remesh to sample) uses for the tip as the export samples it from R.
  return stages.kept.map((position, k) => (stages.keptVertical[k]
    ? { regionId: -1, position, normal: [0, -1, 0], source: 'island' }
    : { regionId: -1, position, normal: stages.keptNormals[k]!, source: 'sharp-ridge' }));
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
export function positionId(position: Vector): string {
  return `auto-${position.map((value) => Math.round(value * 100)).join('_')}`;
}

function pointAt(mesh: TriangleMesh, index: number): Vector {
  const offset = index * 3;
  return [mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!];
}

