import type { GeneratedSupportMesh } from '../core/supports/mesh';
import type { Vector } from '../core/vec3';

/**
 * Drag over in screen space: the brush is a circle of fixed size in canvas pixels that follows
 * the pointer. A support is under it when its projected body (each part reduced to its axis:
 * tip, neck, pillar, foot...) comes within the circle, and some part of it under the circle is
 * not hidden behind the model. Supports never hide each other. Between two pointer events the
 * circle sweeps the straight path (a capsule), so a fast drag skips nothing.
 *
 * Framework-free: the host hands in its view-projection matrix (column-major, three.js
 * `Matrix4.elements` order, including the object's world matrix) and a visibility test.
 */

export type Point2 = readonly [number, number];
/** Column-major 4 × 4 matrix, element `[col * 4 + row]`. */
export type Matrix4 = ArrayLike<number>;

/** Support bodies as axis segments: contact `ids[i]` owns segments `first[i]` to `first[i + 1]`; 6 floats each (a, b). */
export interface BodySegments {
  ids: string[];
  first: Uint32Array;
  points: Float32Array;
}

/**
 * Model-in-front tolerance (mm) of the visibility test: a contact tip sinks a little into the
 * model surface it touches, so the surface right over it must not count as hiding it.
 */
export const HIDE_TOLERANCE = 0.5;
/** Share of a part's height taken as its top and bottom ring. */
const RING_BAND = 0.05;

/**
 * Each support part with a contact, reduced to its axis: the centre of its top ring of vertices
 * to the centre of its bottom ring (unit-local, like the mesh). Braces, raft and labels (no
 * contact) are skipped. Built once per support mesh.
 */
export function bodySegments(mesh: Pick<GeneratedSupportMesh, 'positions' | 'indices' | 'components'>): BodySegments {
  const { positions, indices } = mesh;
  const byContact = new Map<string, number[]>();
  for (const component of mesh.components) {
    if (!component.contactId || component.count === 0) continue;
    const end = component.start + component.count;
    let low = Infinity;
    let high = -Infinity;
    for (let i = component.start; i < end; i++) {
      const y = positions[indices[i]! * 3 + 1]!;
      if (y < low) low = y;
      if (y > high) high = y;
    }
    const band = Math.max(1e-4, (high - low) * RING_BAND);
    const top = [0, 0, 0, 0];
    const bottom = [0, 0, 0, 0];
    for (let i = component.start; i < end; i++) {
      const v = indices[i]! * 3;
      const y = positions[v + 1]!;
      const ring = y >= high - band ? top : y <= low + band ? bottom : undefined;
      if (!ring) continue;
      ring[0]! += positions[v]!;
      ring[1]! += y;
      ring[2]! += positions[v + 2]!;
      ring[3]! += 1;
    }
    // A flat part: both rings are the same vertices.
    const b = bottom[3]! > 0 ? bottom : top;
    let list = byContact.get(component.contactId);
    if (!list) byContact.set(component.contactId, (list = []));
    list.push(top[0]! / top[3]!, top[1]! / top[3]!, top[2]! / top[3]!, b[0]! / b[3]!, b[1]! / b[3]!, b[2]! / b[3]!);
  }
  const ids = [...byContact.keys()];
  const first = new Uint32Array(ids.length + 1);
  let count = 0;
  ids.forEach((id, index) => {
    first[index] = count;
    count += byContact.get(id)!.length / 6;
  });
  first[ids.length] = count;
  const points = new Float32Array(count * 6);
  ids.forEach((id, index) => points.set(byContact.get(id)!, first[index]! * 6));
  return { ids, first, points };
}

/** Canvas pixel position (y down) and clip w of a point; undefined behind the camera (w ≤ 0). */
export function projectPoint(m: Matrix4, p: Vector, width: number, height: number): [number, number, number] | undefined {
  const [x, y, z] = p;
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (!(w > 1e-9)) return undefined;
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  return [(cx / w + 1) * 0.5 * width, (1 - cy / w) * 0.5 * height, w];
}

/**
 * Every body segment on the canvas: 6 floats each (ax, ay, aw, bx, by, bw); NaN when an end is
 * behind the camera. Cheap (two matrix products per segment); the host redoes it only when the
 * camera, the object or the canvas size changed.
 */
export function projectBodies(bodies: BodySegments, m: Matrix4, width: number, height: number): Float32Array {
  const { points } = bodies;
  const out = new Float32Array(points.length);
  const p: Vector = [0, 0, 0];
  for (let i = 0; i < points.length; i += 3) {
    p[0] = points[i]!;
    p[1] = points[i + 1]!;
    p[2] = points[i + 2]!;
    const screen = projectPoint(m, p, width, height);
    if (screen) out.set(screen, i);
    else out.fill(NaN, i, i + 3);
  }
  return out;
}

/** Squared distance from (px, py) to segment ab, and the parameter of the closest point on ab. */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { distance2: number; s: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const s = length2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  const ex = ax + dx * s - px;
  const ey = ay + dy * s - py;
  return { distance2: ex * ex + ey * ey, s };
}

/**
 * Closest approach of screen segment ab (a support part) to segment cd (the brush path): the
 * squared distance and the parameter `s` on ab of its closest point.
 */
export function closestOnSegments(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): { distance2: number; s: number } {
  const rx = bx - ax;
  const ry = by - ay;
  const qx = dx - cx;
  const qy = dy - cy;
  const denominator = rx * qy - ry * qx;
  if (denominator !== 0) {
    const s = ((cx - ax) * qy - (cy - ay) * qx) / denominator;
    const u = ((cx - ax) * ry - (cy - ay) * rx) / denominator;
    if (s >= 0 && s <= 1 && u >= 0 && u <= 1) return { distance2: 0, s };
  }
  let best = toSegment(cx, cy, ax, ay, bx, by);
  const fromD = toSegment(dx, dy, ax, ay, bx, by);
  if (fromD.distance2 < best.distance2) best = fromD;
  const fromA = toSegment(ax, ay, cx, cy, dx, dy).distance2;
  if (fromA < best.distance2) best = { distance2: fromA, s: 0 };
  const fromB = toSegment(bx, by, cx, cy, dx, dy).distance2;
  if (fromB < best.distance2) best = { distance2: fromB, s: 1 };
  return best;
}

/** The 3D parameter along a segment of the point at screen parameter `s`, given its ends' clip w (perspective-correct). */
export function perspectiveParam(s: number, wa: number, wb: number): number {
  const denominator = (1 - s) * wb + s * wa;
  return denominator > 0 ? (s * wa) / denominator : s;
}

/** A point at `pointDistance` from the camera is hidden when the model ray hit is clearly nearer. */
export function hiddenByModel(pointDistance: number, hitDistance: number | undefined, tolerance = HIDE_TOLERANCE): boolean {
  return hitDistance !== undefined && hitDistance < pointDistance - tolerance;
}

/**
 * Contact ids whose support body the brush circle (radius px) touches on its path from `from`
 * (the previous pointer position in this stroke; undefined for a lone circle) to `to`, counting
 * only parts under the circle that `isVisible` (unit-local point: not hidden behind the model).
 * `want` filters ids before any visibility test (the ones a stroke would change), so the costly
 * test runs only where it matters.
 */
export function brushHits(
  bodies: BodySegments,
  projected: Float32Array,
  from: Point2 | undefined,
  to: Point2,
  radius: number,
  isVisible: (point: Vector) => boolean,
  want?: (id: string) => boolean,
): string[] {
  const [cx, cy] = from ?? to;
  const [dx, dy] = to;
  const limit = radius * radius;
  const minX = Math.min(cx, dx) - radius;
  const maxX = Math.max(cx, dx) + radius;
  const minY = Math.min(cy, dy) - radius;
  const maxY = Math.max(cy, dy) + radius;
  const { ids, first, points } = bodies;
  const hits: string[] = [];
  const sample: Vector = [0, 0, 0];
  const visibleAt = (segment: number, t: number) => {
    const o = segment * 6;
    sample[0] = points[o]! + (points[o + 3]! - points[o]!) * t;
    sample[1] = points[o + 1]! + (points[o + 4]! - points[o + 1]!) * t;
    sample[2] = points[o + 2]! + (points[o + 5]! - points[o + 2]!) * t;
    return isVisible(sample);
  };
  for (let contact = 0; contact < ids.length; contact++) {
    const id = ids[contact]!;
    if (want && !want(id)) continue;
    let hit = false;
    for (let segment = first[contact]!; segment < first[contact + 1]! && !hit; segment++) {
      const o = segment * 6;
      const ax = projected[o]!;
      const ay = projected[o + 1]!;
      const bx = projected[o + 3]!;
      const by = projected[o + 4]!;
      // NaN (behind the camera) fails every comparison below.
      if (!(Math.max(ax, bx) >= minX && Math.min(ax, bx) <= maxX && Math.max(ay, by) >= minY && Math.min(ay, by) <= maxY)) continue;
      const closest = closestOnSegments(ax, ay, bx, by, cx, cy, dx, dy);
      if (!(closest.distance2 <= limit)) continue;
      const aw = projected[o + 2]!;
      const bw = projected[o + 5]!;
      // The closest point, then either end that lies under the circle's path too.
      hit = visibleAt(segment, perspectiveParam(closest.s, aw, bw))
        || (closest.s !== 0 && toSegment(ax, ay, cx, cy, dx, dy).distance2 <= limit && visibleAt(segment, 0))
        || (closest.s !== 1 && toSegment(bx, by, cx, cy, dx, dy).distance2 <= limit && visibleAt(segment, 1));
    }
    if (hit) hits.push(id);
  }
  return hits;
}
