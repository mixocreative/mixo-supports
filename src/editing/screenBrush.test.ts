import { describe, expect, it } from 'vitest';
import type { GeneratedSupportMesh, SupportComponent } from '../core/supports/mesh';
import type { Vector } from '../core/vec3';
import {
  bodySegments,
  brushHits,
  closestOnSegments,
  hiddenByModel,
  HIDE_TOLERANCE,
  perspectiveParam,
  projectBodies,
  projectPoint,
  type BodySegments,
} from './screenBrush';

/** Front view, orthographic: 100 × 100 px, screen x = x + 50, screen y = 50 − y (z only matters to visibility). */
const FRONT = [1 / 50, 0, 0, 0, 0, 1 / 50, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const SIZE = 100;

/** Column-major OpenGL perspective (fov 90°, square), camera at the origin looking down −z. */
function perspective(near = 0.1, far = 100): number[] {
  const f = 1;
  return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

/** Bodies straight from segment lists, per contact id. */
function bodies(entries: Record<string, [Vector, Vector][]>): BodySegments {
  const ids = Object.keys(entries);
  const first = new Uint32Array(ids.length + 1);
  const all = ids.flatMap((id) => entries[id]!);
  const points = new Float32Array(all.length * 6);
  all.forEach(([a, b], index) => points.set([...a, ...b], index * 6));
  let count = 0;
  ids.forEach((id, index) => {
    first[index] = count;
    count += entries[id]!.length;
  });
  first[ids.length] = count;
  return { ids, first, points };
}

/** A vertical support at plate x: tip at y = top, pillar down to y = 0, in the plane z. */
const pillar = (x: number, top = 40, z = 0): [Vector, Vector][] => [[[x, top, z], [x, top - 4, z]], [[x, top - 4, z], [x, 0, z]]];

const everyVisible = () => true;

describe('projectPoint', () => {
  it('maps clip space to canvas pixels, y down', () => {
    expect(projectPoint(FRONT, [0, 0, 0], SIZE, SIZE)).toEqual([50, 50, 1]);
    expect(projectPoint(FRONT, [10, 20, 5], SIZE, SIZE)).toEqual([60, 30, 1]);
  });

  it('divides by w in perspective and drops points behind the camera', () => {
    const m = perspective();
    const [x, y, w] = projectPoint(m, [1, 1, -2], 200, 200)!;
    expect(x).toBeCloseTo(150, 9);
    expect(y).toBeCloseTo(50, 9);
    expect(w).toBeCloseTo(2, 9);
    expect(projectPoint(m, [0, 0, 1], 200, 200)).toBeUndefined();
    expect(projectPoint(m, [0, 0, 0], 200, 200)).toBeUndefined();
  });
});

describe('closestOnSegments (screen)', () => {
  it('is zero where the segments cross, with the crossing parameter on the first', () => {
    const hit = closestOnSegments(0, 0, 10, 0, 2.5, -5, 2.5, 5);
    expect(hit.distance2).toBeCloseTo(0, 12);
    expect(hit.s).toBeCloseTo(0.25, 12);
  });

  it('measures to the nearest end or interior point when they do not cross', () => {
    expect(closestOnSegments(0, 0, 10, 0, 5, 3, 5, 8)).toEqual({ distance2: 9, s: 0.5 });
    expect(closestOnSegments(0, 0, 10, 0, 13, 4, 20, 4)).toEqual({ distance2: 25, s: 1 });
  });

  it('handles a point path (no movement) and a point body', () => {
    expect(closestOnSegments(0, 0, 0, 10, 3, 4, 3, 4)).toEqual({ distance2: 9, s: 0.4 });
    expect(closestOnSegments(1, 1, 1, 1, 4, 5, 4, 5)).toEqual({ distance2: 25, s: 0 });
  });
});

describe('perspectiveParam', () => {
  it('turns a screen parameter back into the 3D one along a receding segment', () => {
    const m = perspective();
    const a: Vector = [-1, 0, -2];
    const b: Vector = [3, 1, -20];
    const [ax, ay, aw] = projectPoint(m, a, 200, 200)!;
    const [bx, by, bw] = projectPoint(m, b, 200, 200)!;
    for (const t of [0, 0.2, 0.5, 0.9, 1]) {
      const p: Vector = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const [px, py] = projectPoint(m, p, 200, 200)!;
      const s = Math.hypot(px - ax, py - ay) / Math.hypot(bx - ax, by - ay);
      expect(perspectiveParam(s, aw, bw)).toBeCloseTo(t, 9);
    }
  });
});

describe('hiddenByModel', () => {
  it('is hidden only when the model is hit clearly in front of the point', () => {
    expect(hiddenByModel(50, undefined)).toBe(false);
    expect(hiddenByModel(50, 60)).toBe(false);
    expect(hiddenByModel(50, 50 - HIDE_TOLERANCE / 2)).toBe(false);
    expect(hiddenByModel(50, 40)).toBe(true);
  });
});

describe('bodySegments', () => {
  it('reduces each contact part to its axis (top ring centre to bottom ring centre), skipping parts of no contact', () => {
    // A square tube from y = 2 to 10 around (5, z = 1), and a flat brace with no contact.
    const ring = (y: number) => [[4, y, 0], [6, y, 0], [6, y, 2], [4, y, 2]] as Vector[];
    const vertices = [...ring(10), ...ring(2), [0, 0, 0], [1, 0, 0], [0, 0, 1]] as Vector[];
    const positions = new Float32Array(vertices.flat());
    const tube = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    const indices = new Uint32Array([...tube, 8, 9, 10]);
    const components: SupportComponent[] = [
      { part: 'pillar', contactId: 'a', start: 0, count: tube.length },
      { part: 'brace', start: tube.length, count: 3 },
    ];
    const result = bodySegments({ positions, indices, components } as unknown as GeneratedSupportMesh);
    expect(result.ids).toEqual(['a']);
    expect([...result.first]).toEqual([0, 1]);
    expect([...result.points]).toEqual([5, 10, 1, 5, 2, 1]);
  });

  it('groups every part of one contact, wherever its components sit', () => {
    const positions = new Float32Array([0, 10, 0, 0, 9, 0, 1, 9, 0, 0, 5, 0, 0, 1, 0, 1, 1, 0]);
    const components: SupportComponent[] = [
      { part: 'tip', contactId: 'a', start: 0, count: 3 },
      { part: 'tip', contactId: 'b', start: 3, count: 3 },
      { part: 'pillar', contactId: 'a', start: 6, count: 3 },
    ];
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 3, 4, 5]);
    const result = bodySegments({ positions, indices, components } as unknown as GeneratedSupportMesh);
    expect(result.ids).toEqual(['a', 'b']);
    expect([...result.first]).toEqual([0, 2, 3]);
  });
});

describe('brushHits', () => {
  const hits = (body: BodySegments, from: [number, number] | undefined, to: [number, number], radius: number, visible: (point: Vector) => boolean = everyVisible, want?: (id: string) => boolean) =>
    brushHits(body, projectBodies(body, FRONT, SIZE, SIZE), from, to, radius, visible, want);

  it('selects a support when the circle passes over its pillar, far from its tip', () => {
    const body = bodies({ a: pillar(0) });
    // Plate y = 10 on the pillar: screen (50, 40); the tip is 30 px away.
    expect(hits(body, undefined, [52, 40], 5)).toEqual(['a']);
    expect(hits(body, undefined, [58, 40], 5)).toEqual([]);
  });

  it('fills the gap between two pointer events: a fast drag sweeps every support on its path', () => {
    const row = Object.fromEntries([-20, -15, -10, -5, 0, 5, 10, 15, 20].map((x) => [`c${x}`, pillar(x)]));
    const body = bodies(row);
    expect(hits(body, [25, 40], [75, 40], 2).sort()).toEqual(Object.keys(row).sort());
    // Just the end circle without the path.
    expect(hits(body, undefined, [70, 40], 2)).toEqual(['c20']);
  });

  it('counts a support only where a part under the circle is not hidden behind the model', () => {
    // Pillar in front (z = 0) above y = 20, hidden behind the model (z = −10 here) below it.
    const body = bodies({ low: pillar(0, 40, -10), front: pillar(10) });
    const visible = (point: Vector) => point[2] > -5;
    expect(hits(body, [40, 40], [70, 40], 3, visible)).toEqual(['front']);
  });

  it('does not count a support hidden under the circle even when another part of it shows elsewhere', () => {
    // Top half hidden (the model over it), bottom half visible: a circle over the top does not take it.
    const body = bodies({ a: pillar(0) });
    const visible = (point: Vector) => point[1] < 20;
    expect(hits(body, undefined, [50, 15], 3, visible)).toEqual([]); // plate y = 35
    expect(hits(body, undefined, [50, 40], 3, visible)).toEqual(['a']); // plate y = 10
  });

  it('asks about visibility only for the supports wanted (already selected ones are skipped)', () => {
    const body = bodies({ a: pillar(0), b: pillar(2) });
    const asked: Vector[] = [];
    const visible = (point: Vector) => { asked.push(point); return true; };
    expect(hits(body, undefined, [51, 40], 5, visible, (id) => id === 'b')).toEqual(['b']);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((point) => point[0] === 2)).toBe(true);
  });

  it('skips parts behind the camera', () => {
    const m = perspective();
    const body = bodies({ behind: [[[0, 0, 5], [0, 1, 5]]], ahead: [[[0, 0, -5], [0, 1, -5]]] });
    expect(brushHits(body, projectBodies(body, m, 200, 200), undefined, [100, 95], 10, everyVisible)).toEqual(['ahead']);
  });
});
