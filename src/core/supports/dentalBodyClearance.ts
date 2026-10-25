import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh } from './mesh';
import { tipsOf, meshBounds } from './meshQuery';
import { cross, dot, subtract, type Vector } from '../vec3';

type Triangle = [Vector, Vector, Vector];
type Bounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
const EPS = 1e-8;

function triangle(mesh: TriangleMesh, face: number): Triangle {
  return [0, 1, 2].map((corner) => {
    const offset = mesh.indices[face * 3 + corner]! * 3;
    return [mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!] as Vector;
  }) as Triangle;
}

function bounds([a, b, c]: Triangle): Bounds {
  return { minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]),
    minY: Math.min(a[1], b[1], c[1]), maxY: Math.max(a[1], b[1], c[1]),
    minZ: Math.min(a[2], b[2], c[2]), maxZ: Math.max(a[2], b[2], c[2]) };
}

function segmentHitsTriangle(from: Vector, to: Vector, [a, b, c]: Triangle): boolean {
  const normal = cross(subtract(b, a), subtract(c, a));
  const direction = subtract(to, from);
  const denominator = dot(normal, direction);
  if (Math.abs(denominator) < EPS) return false;
  const t = dot(normal, subtract(a, from)) / denominator;
  if (t < -EPS || t > 1 + EPS) return false;
  const point: Vector = [from[0] + t * direction[0], from[1] + t * direction[1], from[2] + t * direction[2]];
  return dot(normal, cross(subtract(b, a), subtract(point, a))) >= -EPS &&
    dot(normal, cross(subtract(c, b), subtract(point, b))) >= -EPS &&
    dot(normal, cross(subtract(a, c), subtract(point, c))) >= -EPS;
}

function coplanarOverlap(a: Triangle, b: Triangle): boolean {
  const normal = cross(subtract(a[1], a[0]), subtract(a[2], a[0]));
  const length = Math.hypot(...normal);
  if (length < EPS || Math.abs(dot(normal, subtract(b[0], a[0]))) > EPS * length) return false;
  const otherNormal = cross(subtract(b[1], b[0]), subtract(b[2], b[0]));
  const otherLength = Math.hypot(...otherNormal);
  if (otherLength < EPS || Math.hypot(...cross(normal, otherNormal)) > EPS * length * otherLength) return false;
  const omit = [0, 1, 2].reduce((best, axis) => Math.abs(normal[axis]!) > Math.abs(normal[best]!) ? axis : best, 0);
  const axes = [0, 1, 2].filter((axis) => axis !== omit);
  const project = (point: Vector): [number, number] => [point[axes[0]!]!, point[axes[1]!]!];
  const left = a.map(project), right = b.map(project);
  const orient = (p: number[], q: number[], r: number[]) => (q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!);
  const within = (p: number[], q: number[], r: number[]) => r[0]! >= Math.min(p[0]!, q[0]!) - EPS &&
    r[0]! <= Math.max(p[0]!, q[0]!) + EPS && r[1]! >= Math.min(p[1]!, q[1]!) - EPS && r[1]! <= Math.max(p[1]!, q[1]!) + EPS;
  const edgesIntersect = (p: number[], q: number[], r: number[], s: number[]) => {
    const o1 = orient(p, q, r), o2 = orient(p, q, s), o3 = orient(r, s, p), o4 = orient(r, s, q);
    return (o1 * o2 < 0 && o3 * o4 < 0) ||
      (Math.abs(o1) <= EPS && within(p, q, r)) || (Math.abs(o2) <= EPS && within(p, q, s)) ||
      (Math.abs(o3) <= EPS && within(r, s, p)) || (Math.abs(o4) <= EPS && within(r, s, q));
  };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (edgesIntersect(left[i]!, left[(i + 1) % 3]!, right[j]!, right[(j + 1) % 3]!)) return true;
  }
  const contains = (triangle2d: number[][], point: number[]) => {
    const signs = [0, 1, 2].map((i) => orient(triangle2d[i]!, triangle2d[(i + 1) % 3]!, point));
    return signs.every((value) => value >= -EPS) || signs.every((value) => value <= EPS);
  };
  return contains(left, right[0]!) || contains(right, left[0]!);
}

function trianglesIntersect(a: Triangle, b: Triangle): boolean {
  for (let edge = 0; edge < 3; edge++) {
    if (segmentHitsTriangle(a[edge]!, a[(edge + 1) % 3]!, b) ||
      segmentHitsTriangle(b[edge]!, b[(edge + 1) % 3]!, a)) return true;
  }
  return coplanarOverlap(a, b);
}

/** Exact non-coplanar triangle checks on model faces near an automatic pillar. Intentional landing-tip triangles are excluded. */
export function crossingAutomaticBodyContactIds(model: TriangleMesh, supports: GeneratedSupportMesh, automaticIds: ReadonlySet<string>): string[] {
  if (automaticIds.size === 0 || model.indices.length === 0 || supports.indices.length === 0) return [];
  const extent = meshBounds(model);
  const cell = Math.max(0.5, Math.max(extent.max[0] - extent.min[0], extent.max[2] - extent.min[2]) / 64);
  const cells = new Map<string, number[]>();
  const modelBounds: Bounds[] = [];
  const key = (x: number, z: number) => `${x}|${z}`;
  for (let face = 0; face < model.indices.length / 3; face++) {
    const box = bounds(triangle(model, face));
    modelBounds.push(box);
    for (let x = Math.floor(box.minX / cell); x <= Math.floor(box.maxX / cell); x++) {
      for (let z = Math.floor(box.minZ / cell); z <= Math.floor(box.maxZ / cell); z++) {
        const id = key(x, z);
        const list = cells.get(id);
        if (list) list.push(face); else cells.set(id, [face]);
      }
    }
  }
  const tipView = tipsOf(supports);
  const triangleKey = (indices: Uint32Array, at: number) => `${indices[at]},${indices[at + 1]},${indices[at + 2]}`;
  const landingTips = new Set<string>();
  for (let at = 0; at < tipView.indices.length; at += 3) landingTips.add(triangleKey(tipView.indices, at));
  const crossing = new Set<string>();
  const seen = new Uint32Array(model.indices.length / 3);
  let stamp = 0;
  for (const component of supports.components) {
    const id = component.contactId;
    if (component.part !== 'pillar' || !id || !automaticIds.has(id)) continue;
    for (let at = component.start; at < component.start + component.count && !crossing.has(id); at += 3) {
      if (landingTips.has(triangleKey(supports.indices, at))) continue;
      const pillar = triangle(supports, at / 3);
      const box = bounds(pillar);
      stamp++;
      for (let x = Math.floor(box.minX / cell); x <= Math.floor(box.maxX / cell) && !crossing.has(id); x++) {
        for (let z = Math.floor(box.minZ / cell); z <= Math.floor(box.maxZ / cell) && !crossing.has(id); z++) {
          for (const face of cells.get(key(x, z)) ?? []) {
            if (seen[face] === stamp) continue;
            seen[face] = stamp;
            const candidate = modelBounds[face]!;
            if (candidate.maxY < box.minY || candidate.minY > box.maxY ||
              candidate.maxX < box.minX || candidate.minX > box.maxX ||
              candidate.maxZ < box.minZ || candidate.minZ > box.maxZ) continue;
            if (trianglesIntersect(pillar, triangle(model, face))) {
              crossing.add(id);
              break;
            }
          }
        }
      }
    }
  }
  return [...crossing].sort();
}
