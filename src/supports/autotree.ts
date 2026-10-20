import type { TriangleMesh } from '../analysis/types';
import { RemeshTarget, type Polygon } from './remesh';
import type { LiveSupportSettings } from './settings';

type Vector = [number, number, number];

export interface TreeContact {
  position: Vector;
  /** Manual contacts join after the scatter's Auto Tree branch and never merge. */
  tree?: boolean;
}

export interface AutoTree {
  junction: Vector;
  members: number[];
}

export interface AutoTreeLayout {
  trees: AutoTree[];
  /** Contacts the scatter deletes: within Safe Distance above a non-overhang face. */
  removed: Set<number>;
}

/**
 * Auto Tree as SLASG_VertexScatter_Mixo builds it, followed by MIXO_ManualPoints:
 * 1. a contact can branch when a ray straight down (from Spacing/32 below it) misses the
 *    model's non-overhang faces pushed out by Safe Distance along their vertex normals; a
 *    contact whose ray hits that pushed-out copy but misses the copy pulled in by Safe
 *    Distance is deleted;
 * 2. Merge by Distance (Merge Distance) clusters their duplicates greedily in index order,
 *    each cluster collapsing to the average of its members; one-member clusters fuse back
 *    onto their contact (the Spacing/16 clean-up merge) and stay plain columns;
 * 3. the junction drops to (member height average) - Branch Descent - 2 x the longest
 *    horizontal branch, and is dropped (members become plain columns) below Spacing;
 * 4. ManualPoints snaps every point, junctions included, onto the nearest model surface.
 */
export function autoTreeLayout(contacts: readonly TreeContact[], model: TriangleMesh | undefined, settings: Readonly<LiveSupportSettings>): AutoTreeLayout {
  const spacing = settings.scatterSpacing;
  const faces = model ? triangles(model) : [];
  const blockers = model ? blockerFaces(model, settings.scatterAngle * Math.PI / 180) : [];
  const safe = settings.scatterSafeDistance;
  const limit = settings.scatterAngle * Math.PI / 180;
  // The scatter takes these faces from its remesh R (voxel Spacing / 4). Without Safe Distance
  // the exact faces give the same answer; with it, R's vertex normals decide the corners.
  const remesh = model && safe !== 0 ? new RemeshTarget(model, 0, spacing / 4) : undefined;
  const removed = new Set<number>();
  const normals = new Map<string, Vector>();
  const eligible = contacts.map((contact, index) => {
    const from: Vector = [contact.position[0], contact.position[1] - spacing / 32, contact.position[2]];
    if (!remesh) return contact.tree !== false && !hitsBelow(blockers, from, contact.position[1]);
    const [outward, inward] = remeshBlockers(remesh, from, contact.position[1], safe, limit, normals);
    const blocked = hitsBelow(outward, from, contact.position[1]);
    if (blocked && !hitsBelow(inward, from, contact.position[1])) removed.add(index);
    return contact.tree !== false && !blocked;
  });

  const assigned = contacts.map((_, index) => !eligible[index] || removed.has(index));
  const trees: AutoTree[] = [];
  const clusters: { members: number[]; average: Vector }[] = [];
  contacts.forEach((seed, index) => {
    if (assigned[index]) return;
    const members: number[] = [];
    contacts.forEach((other, k) => {
      if (!assigned[k] && distance(seed.position, other.position) <= settings.scatterMergeDistance) {
        assigned[k] = true;
        members.push(k);
      }
    });
    if (members.length < 2) return;
    clusters.push({ members, average: mean(members.map((k) => contacts[k]!.position)) });
  });
  // The Spacing/16 clean-up merge welds every point within reach of a junction into it: the
  // contact disappears and the junction moves to the mean of the welded points.
  for (const cluster of clusters) {
    const welded = contacts.flatMap((contact, k) => !removed.has(k) && distance(contact.position, cluster.average) <= spacing / 16 ? [k] : []);
    if (welded.length === 0) continue;
    cluster.average = mean([cluster.average, ...welded.map((k) => contacts[k]!.position)]);
    for (const k of welded) removed.add(k);
  }
  for (const cluster of clusters) {
    const members = cluster.members.filter((k) => !removed.has(k));
    if (members.length === 0) continue;
    const { average } = cluster;
    const reach = Math.max(...members.map((k) => Math.hypot(contacts[k]!.position[0] - average[0], contacts[k]!.position[2] - average[2])));
    const y = average[1] - settings.scatterBranchDescent - 2 * reach;
    if (y < spacing) continue;
    const junction: Vector = [average[0], y, average[2]];
    trees.push({ junction: faces.length ? closestOnMesh(faces, junction) : junction, members });
  }
  return { trees, removed };
}

interface BlockerFace { a: Vector; b: Vector; c: Vector; normals: [Vector, Vector, Vector] }

/**
 * The model's non-overhang faces (Separate Geometry), each corner carrying the vertex normal
 * of that separated mesh: the corner-angle-weighted sum of the face normals around it
 * (vertices are identified by position, so unwelded imports behave as welded ones).
 */
function blockerFaces(model: TriangleMesh, limit: number): BlockerFace[] {
  const kept: { ids: [string, string, string]; points: [Vector, Vector, Vector]; normal: Vector }[] = [];
  for (let face = 0; face < model.indices.length / 3; face += 1) {
    const points = [0, 1, 2].map((k) => {
      const i = model.indices[face * 3 + k]! * 3;
      return [model.positions[i]!, model.positions[i + 1]!, model.positions[i + 2]!] as Vector;
    }) as [Vector, Vector, Vector];
    const ids = points.map((p) => p.map((v) => Math.round(v * 1e5)).join('|')) as [string, string, string];
    const normal = normalize(cross(sub(points[1], points[0]), sub(points[2], points[0])));
    if (Math.acos(Math.max(-1, Math.min(1, -normal[1]))) > limit) kept.push({ ids, points, normal });
  }
  const sums = new Map<string, Vector>();
  for (const { ids, points, normal } of kept) {
    ids.forEach((id, k) => {
      const a = sub(points[(k + 2) % 3]!, points[k]!);
      const b = sub(points[(k + 1) % 3]!, points[k]!);
      const la = Math.hypot(...a);
      const lb = Math.hypot(...b);
      if (la === 0 || lb === 0) return;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb))));
      sums.set(id, add(sums.get(id) ?? [0, 0, 0], scale(normal, angle)));
    });
  }
  return kept.map(({ ids, points }) => ({ a: points[0], b: points[1], c: points[2], normals: ids.map((id) => normalize(sums.get(id)!)) as [Vector, Vector, Vector] }));
}

type Triangle = { a: Vector; b: Vector; c: Vector };

/**
 * R's non-overhang faces near the ray from `from` straight down over `length`, moved out
 * (first list) and in (second list) by Safe Distance along their vertex normals.
 */
function remeshBlockers(remesh: RemeshTarget, from: Vector, length: number, safe: number, limit: number, normals: Map<string, Vector>): [Triangle[], Triangle[]] {
  const keep = (polygon: Polygon) => Math.acos(Math.max(-1, Math.min(1, -polygon.normal[1]))) > limit;
  const reach = Math.abs(safe);
  // Corners move at most Safe Distance, so only polygons within that of the ray can be hit.
  const near = (polygon: Polygon) => {
    const xs = polygon.corners.map((c) => c[0]);
    const zs = polygon.corners.map((c) => c[2]);
    return from[0] >= Math.min(...xs) - reach && from[0] <= Math.max(...xs) + reach && from[2] >= Math.min(...zs) - reach && from[2] <= Math.max(...zs) + reach;
  };
  const polygons = remesh.polygonsNearColumn(from[0], from[2], reach + remesh.voxel, from[1] + reach + remesh.voxel, from[1] - length - reach).filter((polygon) => near(polygon) && keep(polygon));
  const normalOf = (id: string) => {
    let normal = normals.get(id);
    if (!normal) normals.set(id, (normal = remesh.vertexNormal(id, keep)));
    return normal;
  };
  const moved = (sign: number): Triangle[] => polygons.flatMap((polygon) => {
    const corners = polygon.corners.map((corner, k) => add(corner, scale(normalOf(polygon.vertices[k]!), sign * safe)));
    return corners.slice(1, -1).map((corner, k) => ({ a: corners[0]!, b: corner, c: corners[k + 2]! }));
  });
  return [moved(1), moved(-1)];
}

interface Face { a: Vector; b: Vector; c: Vector; normal: Vector }

function triangles(model: TriangleMesh): Face[] {
  const out: Face[] = [];
  for (let face = 0; face < model.indices.length / 3; face += 1) {
    const [a, b, c] = [0, 1, 2].map((k) => {
      const i = model.indices[face * 3 + k]! * 3;
      return [model.positions[i]!, model.positions[i + 1]!, model.positions[i + 2]!] as Vector;
    }) as [Vector, Vector, Vector];
    out.push({ a, b, c, normal: normalize(cross(sub(b, a), sub(c, a))) });
  }
  return out;
}

function hitsBelow(faces: readonly { a: Vector; b: Vector; c: Vector }[], from: Vector, length: number): boolean {
  return faces.some(({ a, b, c }) => {
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(det) < 1e-12) return false;
    const l1 = ((b[2] - c[2]) * (from[0] - c[0]) + (c[0] - b[0]) * (from[2] - c[2])) / det;
    const l2 = ((c[2] - a[2]) * (from[0] - c[0]) + (a[0] - c[0]) * (from[2] - c[2])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) return false;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    return y < from[1] && from[1] - y <= length;
  });
}

/** Closest point on the mesh surface (Sample Nearest Surface). */
export function closestOnMesh(faces: readonly Face[], point: Vector): Vector {
  let best: Vector = point;
  let bestDistance = Infinity;
  for (const { a, b, c } of faces) {
    const candidate = closestOnTriangle(point, a, b, c);
    const d = distance(candidate, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
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

function add(a: Vector, b: Vector): Vector { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: Vector, b: Vector): Vector { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(v: Vector, s: number): Vector { return [v[0] * s, v[1] * s, v[2] * s]; }
function dot(a: Vector, b: Vector): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vector, b: Vector): Vector { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function mean(points: readonly Vector[]): Vector {
  return points.reduce<Vector>((sum, p) => add(sum, p), [0, 0, 0]).map((value) => value / points.length) as Vector;
}
function distance(a: Vector, b: Vector): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function normalize(v: Vector): Vector {
  const length = Math.hypot(...v);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}
