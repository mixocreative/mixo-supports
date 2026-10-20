import type { TriangleMesh } from '../analysis/types';
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

/**
 * Auto Tree as SLASG_VertexScatter_Mixo builds it, followed by MIXO_ManualPoints:
 * 1. a contact can branch when a ray straight down (from Spacing/32 below it) misses the
 *    model's non-overhang faces;
 * 2. Merge by Distance (Merge Distance) clusters their duplicates greedily in index order,
 *    each cluster collapsing to the average of its members; one-member clusters fuse back
 *    onto their contact (the Spacing/16 clean-up merge) and stay plain columns;
 * 3. the junction drops to (member height average) - Branch Descent - 2 x the longest
 *    horizontal branch, and is dropped (members become plain columns) below Spacing;
 * 4. ManualPoints snaps every point, junctions included, onto the nearest model surface.
 */
export function autoTreeLayout(contacts: readonly TreeContact[], model: TriangleMesh | undefined, settings: Readonly<LiveSupportSettings>): AutoTree[] {
  const spacing = settings.scatterSpacing;
  const faces = model ? triangles(model) : [];
  const limit = settings.scatterAngle * Math.PI / 180;
  const blockers = faces.filter((face) => Math.acos(Math.max(-1, Math.min(1, -face.normal[1]))) > limit);
  const eligible = contacts.map((contact) => contact.tree !== false && !hitsBelow(blockers, [contact.position[0], contact.position[1] - spacing / 32, contact.position[2]], contact.position[1]));

  const assigned = contacts.map((_, index) => !eligible[index]);
  const trees: AutoTree[] = [];
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
    const average = members.reduce<Vector>((sum, k) => add(sum, contacts[k]!.position), [0, 0, 0]).map((value) => value / members.length) as Vector;
    const reach = Math.max(...members.map((k) => Math.hypot(contacts[k]!.position[0] - average[0], contacts[k]!.position[2] - average[2])));
    const y = average[1] - settings.scatterBranchDescent - 2 * reach;
    if (y < spacing) return;
    const junction: Vector = [average[0], y, average[2]];
    trees.push({ junction: faces.length ? closestOnMesh(faces, junction) : junction, members });
  });
  return trees;
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

function hitsBelow(faces: readonly Face[], from: Vector, length: number): boolean {
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
function distance(a: Vector, b: Vector): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function normalize(v: Vector): Vector {
  const length = Math.hypot(...v);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}
