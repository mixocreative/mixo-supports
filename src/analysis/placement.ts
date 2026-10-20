import { edgeAnchors } from './edgeAnchors';
import { classifyDownwardFaces, partitionRegions } from './mesh';
import type {
  PlacementResult,
  PlacementSettings,
  SupportPoint,
  SupportPointSource,
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
export function generatePlacement(mesh: TriangleMesh, settings: PlacementSettings): PlacementResult {
  validateSettings(settings);
  const downward = classifyDownwardFaces(mesh, settings.overhangAngleDegrees);
  const regions = partitionRegions(mesh, downward);
  const regionOf = new Map<number, number>();
  for (const region of regions) for (const face of region.faceIndices) regionOf.set(face, region.id);

  const candidates: Candidate[] = [];
  if (settings.includeDownward !== false) candidates.push(...poissonOnOverhangs(mesh, settings, regionOf));
  if (settings.includeIslands) candidates.push(...plateauMinima(mesh, settings), ...islandMinima(mesh, settings));
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

/** Final contacts for one unit: automatic contacts minus suppressed IDs, then manual additions. */
export function composeContacts(
  auto: readonly SupportPoint[],
  manual: readonly SupportPoint[],
  suppressed: readonly string[],
): SupportPoint[] {
  const hidden = new Set(suppressed);
  return [...auto.filter((point) => !hidden.has(point.id)), ...manual];
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
function poissonOnOverhangs(mesh: TriangleMesh, settings: PlacementSettings, regionOf: ReadonlyMap<number, number>): Candidate[] {
  const spacing = settings.spacing;
  const density = (1 / spacing) ** 4;
  const cosine = Math.cos(settings.overhangAngleDegrees * Math.PI / 180);
  const raw: Candidate[] = [];
  let selected = 0;
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    const [a, b, c] = [0, 1, 2].map((k) => pointAt(mesh, mesh.indices[face * 3 + k]!)) as [Vector, Vector, Vector];
    const crossed = cross(subtract(b, a), subtract(c, a));
    const normal = normalize(crossed);
    if (-normal[1] < cosine - 1e-9) continue;
    const area = Math.hypot(...crossed) / 2;
    const rng = new BlenderRng(blenderHash(selected, 0));
    selected += 1;
    const amount = area * density;
    const count = Math.floor(amount) + ((amount - Math.floor(amount)) > rng.float() ? 1 : 0);
    for (let point = 0; point < count; point += 1) {
      let r1 = rng.float();
      let r2 = rng.float();
      if (r1 + r2 > 1) {
        r1 = 1 - r1;
        r2 = 1 - r2;
      }
      const position = add(add(scale(a, r1), scale(b, r2)), scale(c, 1 - r1 - r2));
      raw.push({ regionId: regionOf.get(face) ?? -1, position, normal, source: 'interior' });
    }
  }
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
 * Island minima: vertices whose lowest adjacent edge midpoint is not below them, merged within
 * Spacing (first point kept), dropped when the vertex normal leans past Overhang Angle.
 */
function islandMinima(mesh: TriangleMesh, settings: PlacementSettings): Candidate[] {
  const vertexCount = mesh.positions.length / 3;
  const lowestNeighbour = new Float64Array(vertexCount).fill(Infinity);
  const normals = new Float64Array(vertexCount * 3);
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    const ids = [0, 1, 2].map((k) => mesh.indices[face * 3 + k]!);
    const verts = ids.map((id) => pointAt(mesh, id)) as [Vector, Vector, Vector];
    const normal = normalize(cross(subtract(verts[1], verts[0]), subtract(verts[2], verts[0])));
    for (let k = 0; k < 3; k += 1) {
      const [i, j] = [ids[k]!, ids[(k + 1) % 3]!];
      const midpoint = (verts[k]![1] + verts[(k + 1) % 3]![1]) / 2;
      lowestNeighbour[i] = Math.min(lowestNeighbour[i]!, midpoint);
      lowestNeighbour[j] = Math.min(lowestNeighbour[j]!, midpoint);
      // Angle-weighted vertex normal, as Blender computes vertex normals.
      const corner = verts[k]!;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(normalize(subtract(verts[(k + 1) % 3]!, corner)), normalize(subtract(verts[(k + 2) % 3]!, corner))))));
      for (let axis = 0; axis < 3; axis += 1) normals[ids[k]! * 3 + axis] += normal[axis]! * angle;
    }
  }
  const limit = settings.overhangAngleDegrees * Math.PI / 180;
  const minima: Candidate[] = [];
  const onPlateau = plateauVertices(mesh);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const position = pointAt(mesh, vertex);
    if (onPlateau.has(vertex)) continue;
    if (lowestNeighbour[vertex]! < position[1] || lowestNeighbour[vertex] === Infinity) continue;
    const normal = normalize([normals[vertex * 3]!, normals[vertex * 3 + 1]!, normals[vertex * 3 + 2]!]);
    if (Math.acos(Math.max(-1, Math.min(1, -normal[1]))) > limit) continue;
    if (minima.some((other) => distance(other.position, position) < settings.spacing)) continue;
    minima.push({ regionId: -1, position, normal: [0, -1, 0], source: 'island' });
  }
  return minima;
}

/** Exactly horizontal, downward-facing triangles: the remesh turns these into minima plateaus. */
function plateauFaces(mesh: TriangleMesh): number[] {
  const faces: number[] = [];
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    const [a, b, c] = [0, 1, 2].map((k) => pointAt(mesh, mesh.indices[face * 3 + k]!)) as [Vector, Vector, Vector];
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    if (normal[1] < -1 + 1e-9) faces.push(face);
  }
  return faces;
}

function plateauVertices(mesh: TriangleMesh): Set<number> {
  const out = new Set<number>();
  for (const face of plateauFaces(mesh)) for (let k = 0; k < 3; k += 1) out.add(mesh.indices[face * 3 + k]!);
  return out;
}

/**
 * Minima of the Spacing/4 remesh on horizontal overhangs (emulating OpenVDB adaptive meshing,
 * adaptivity 0.1). Every remesh vertex of a flat plateau sits at the same height, so all are
 * local minima. Adaptivity collapses each fully flat 8-voxel leaf block (2 x Spacing) into one
 * vertex at its centre; blocks touching other geometry keep full-resolution vertices (none
 * within a voxel of an edge where the surface drops away), and the rounded rim contributes
 * vertices on the plateau edge on its minimum-x / minimum-Blender-y sides only, as observed.
 * Merge by Distance (Spacing) clusters the vertices in order; each cluster is averaged and
 * snapped back to its nearest member.
 */
function plateauMinima(mesh: TriangleMesh, settings: PlacementSettings): Candidate[] {
  const voxel = settings.spacing / 4;
  const block = 8 * voxel;
  const faces = plateauFaces(mesh);
  if (faces.length === 0) return [];
  const plateau = new Set(faces);
  const edgeFaces = new Map<string, number[]>();
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    for (let k = 0; k < 3; k += 1) {
      const a = mesh.indices[face * 3 + k]!;
      const b = mesh.indices[face * 3 + (k + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const list = edgeFaces.get(key);
      if (list) list.push(face); else edgeFaces.set(key, [face]);
    }
  }
  const drops: [Vector, Vector][] = [];
  const rims: { a: Vector; b: Vector; outward: [number, number] }[] = [];
  for (const [key, list] of edgeFaces) {
    const inside = list.filter((face) => plateau.has(face));
    if (inside.length !== 1) continue;
    const [a, b] = key.split(':').map((id) => pointAt(mesh, Number(id))) as [Vector, Vector];
    const other = list.find((face) => !plateau.has(face));
    const lowest = other === undefined ? a[1] : Math.min(...[0, 1, 2].map((k) => pointAt(mesh, mesh.indices[other * 3 + k]!)[1]));
    if (lowest < a[1] - 1e-6) {
      drops.push([a, b]);
      continue;
    }
    // Outward direction of the rim edge in plan, away from its plateau face's centre.
    const face = inside[0]!;
    const centre = [0, 1, 2].map((k) => pointAt(mesh, mesh.indices[face * 3 + k]!)).reduce((sum, p) => add(sum, p), [0, 0, 0] as Vector);
    const mid: Vector = [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2];
    let outward: [number, number] = [-(b[2] - a[2]), b[0] - a[0]];
    if (outward[0] * (mid[0] - centre[0] / 3) + outward[1] * (mid[2] - centre[2] / 3) < 0) outward = [-outward[0], -outward[1]];
    rims.push({ a, b, outward });
  }
  const insidePlateau = (x: number, z: number, y: number) => faces.some((face) => {
    const [a, b, c] = [0, 1, 2].map((k) => pointAt(mesh, mesh.indices[face * 3 + k]!)) as [Vector, Vector, Vector];
    return Math.abs(a[1] - y) < 1e-6 && insideTriangleXZ(a, b, c, x, z);
  });
  // The remesh unions overlapping parts: a plateau point with solid directly below it (odd
  // crossings straight down) is interior, and solid within a voxel is a drop (e.g. a stem).
  const solid = new VerticalParity(mesh);
  const below = (x: number, z: number, y: number) => solid.inside(x, y - 1e-3, z);
  const nearSolid = (x: number, z: number, y: number, reach: number) => below(x, z, y)
    || Array.from({ length: 8 }, (_, k) => (k / 8) * Math.PI * 2).some((angle) => below(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach, y));
  const nearDrop = (x: number, z: number, reach: number, y = Number.NaN) => drops.some(([p, q]) => segmentDistanceXZ(p, q, x, z) < reach)
    || (!Number.isNaN(y) && nearSolid(x, z, y, reach));
  const nearEdge = (x: number, z: number, reach: number) => drops.some(([p, q]) => segmentDistanceXZ(p, q, x, z) < reach) || rims.some(({ a, b }) => segmentDistanceXZ(a, b, x, z) < reach);

  const heights = [...new Set(faces.map((face) => Math.round(pointAt(mesh, mesh.indices[face * 3]!)[1] * 1e6) / 1e6))];
  const vertices: Vector[] = [];
  for (const y of heights) {
    const levelFaces = faces.filter((face) => Math.abs(pointAt(mesh, mesh.indices[face * 3]!)[1] - y) < 1e-6);
    const xs = levelFaces.flatMap((face) => [0, 1, 2].map((k) => pointAt(mesh, mesh.indices[face * 3 + k]!)[0]));
    const zs = levelFaces.flatMap((face) => [0, 1, 2].map((k) => pointAt(mesh, mesh.indices[face * 3 + k]!)[2]));
    for (let bi = Math.floor(Math.min(...xs) / block); bi * block < Math.max(...xs); bi += 1) {
      for (let bj = Math.floor(Math.min(...zs) / block); bj * block < Math.max(...zs); bj += 1) {
        const cx = (bi + 0.5) * block;
        const cz = (bj + 0.5) * block;
        const corners: [number, number][] = [[bi * block, bj * block], [(bi + 1) * block, bj * block], [(bi + 1) * block, (bj + 1) * block], [bi * block, (bj + 1) * block]];
        const lattice: [number, number][] = [];
        for (let i = 0; i < 8; i += 1) for (let j = 0; j < 8; j += 1) lattice.push([bi * block + (i + 0.5) * voxel, bj * block + (j + 0.5) * voxel]);
        const touchesSolid = lattice.some(([x, z]) => below(x, z, y)) || corners.some(([x, z]) => nearSolid(x, z, y, voxel));
        const flat = !touchesSolid && corners.every(([x, z]) => insidePlateau(x, z, y)) && !nearEdge(cx, cz, block / 2 + voxel)
          && !drops.concat(rims.map(({ a, b }) => [a, b] as [Vector, Vector])).some(([p, q]) => segmentDistanceXZ(p, q, cx, cz) < block * Math.SQRT1_2 + voxel);
        if (flat) {
          vertices.push([cx, y, cz]);
          continue;
        }
        // Blocks that only meet the outer rim keep no interior minima; only drops (the surface
        // falling away, e.g. a stem) leave full-resolution minima around them.
        if (!touchesSolid && !drops.some(([p, q]) => segmentDistanceXZ(p, q, cx, cz) < block * Math.SQRT1_2 + voxel)) continue;
        for (let i = 0; i < 8; i += 1) {
          for (let j = 0; j < 8; j += 1) {
            const x = bi * block + (i + 0.5) * voxel;
            const z = bj * block + (j + 0.5) * voxel;
            if (!insidePlateau(x, z, y) || nearDrop(x, z, voxel, y) || nearEdge(x, z, voxel / 2)) continue;
            vertices.push([x, y, z]);
          }
        }
      }
    }
    for (const { a, b, outward } of rims) {
      if (Math.abs(a[1] - y) > 1e-6) continue;
      // Blender minimum sides: outward -x, or outward -y in Blender (= +z on the web).
      if (!(outward[0] < -1e-9 || outward[1] > 1e-9)) continue;
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      for (let t = voxel / 2; t < length; t += voxel) {
        const x = a[0] + (b[0] - a[0]) * (t / length);
        const z = a[2] + (b[2] - a[2]) * (t / length);
        if (!nearDrop(x, z, voxel, y)) vertices.push([x, y, z]);
      }
    }
  }
  const points = vertices.sort((p, q) => p[0] - q[0] || p[2] - q[2] || p[1] - q[1]);
  const assigned = new Array<boolean>(points.length).fill(false);
  const minima: Candidate[] = [];
  points.forEach((seed, index) => {
    if (assigned[index]) return;
    const cluster: Vector[] = [];
    points.forEach((other, k) => {
      if (!assigned[k] && distance(seed, other) <= settings.spacing) {
        assigned[k] = true;
        cluster.push(other);
      }
    });
    const centre = scale(cluster.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vector), 1 / cluster.length);
    const snapped = cluster.reduce((best, p) => (distance(p, centre) < distance(best, centre) ? p : best));
    minima.push({ regionId: -1, position: snapped, normal: [0, -1, 0], source: 'island' });
  });
  return minima;
}

/** Parity of crossings straight down: whether a point lies inside the closed model. */
class VerticalParity {
  private cells = new Map<string, number[]>();
  private size: number;
  constructor(private mesh: TriangleMesh) {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      xs.push(mesh.positions[i]!);
      zs.push(mesh.positions[i + 2]!);
    }
    this.size = Math.max(0.5, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 64);
    for (let face = 0; face < mesh.indices.length / 3; face += 1) {
      const fx = [0, 1, 2].map((k) => mesh.positions[mesh.indices[face * 3 + k]! * 3]!);
      const fz = [0, 1, 2].map((k) => mesh.positions[mesh.indices[face * 3 + k]! * 3 + 2]!);
      for (let ix = Math.floor(Math.min(...fx) / this.size); ix <= Math.floor(Math.max(...fx) / this.size); ix += 1) {
        for (let iz = Math.floor(Math.min(...fz) / this.size); iz <= Math.floor(Math.max(...fz) / this.size); iz += 1) {
          const key = `${ix}|${iz}`;
          const list = this.cells.get(key);
          if (list) list.push(face); else this.cells.set(key, [face]);
        }
      }
    }
  }

  inside(x: number, y: number, z: number): boolean {
    let crossings = 0;
    for (const face of this.cells.get(`${Math.floor(x / this.size)}|${Math.floor(z / this.size)}`) ?? []) {
      const [a, b, c] = [0, 1, 2].map((k) => pointAt(this.mesh, this.mesh.indices[face * 3 + k]!)) as [Vector, Vector, Vector];
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
      const l3 = 1 - l1 - l2;
      // Half-open barycentric test so shared edges are counted once.
      if (l1 < 0 || l2 < 0 || l3 <= 0) continue;
      if (l1 * a[1] + l2 * b[1] + l3 * c[1] < y) crossings += 1;
    }
    return crossings % 2 === 1;
  }
}

function insideTriangleXZ(a: Vector, b: Vector, c: Vector, x: number, z: number): boolean {
  const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(det) < 1e-12) return false;
  const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
  const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
  return l1 >= -1e-9 && l2 >= -1e-9 && 1 - l1 - l2 >= -1e-9;
}

function segmentDistanceXZ(a: Vector, b: Vector, x: number, z: number): number {
  const ex = b[0] - a[0];
  const ez = b[2] - a[2];
  const length = ex * ex + ez * ez;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[2]) * ez) / length));
  return Math.hypot(x - (a[0] + ex * t), z - (a[2] + ez * t));
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
