import { cross, dot, subtract, type Vector } from '../vec3';

export type Triangle3D = readonly [Vector, Vector, Vector];

const EPS = 1e-8;

function segmentHitsTriangle(from: Vector, to: Vector, [a, b, c]: Triangle3D): boolean {
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

function coplanarOverlap(a: Triangle3D, b: Triangle3D): boolean {
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

export function trianglesIntersect3D(left: Triangle3D, right: Triangle3D): boolean {
  for (let edge = 0; edge < 3; edge++) {
    if (segmentHitsTriangle(left[edge]!, left[(edge + 1) % 3]!, right) ||
      segmentHitsTriangle(right[edge]!, right[(edge + 1) % 3]!, left)) return true;
  }
  return coplanarOverlap(left, right);
}
