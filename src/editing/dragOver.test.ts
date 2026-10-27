import { describe, expect, it } from 'vitest';
import type { Vector } from '../core/vec3';
import { createBrushScheduler, type Brush, type FrameTest } from './brushScheduler';
import { createDragOver } from './dragOver';
import { createStroke } from './stroke';
import type { BrushMode } from './types';

/**
 * Drag over end to end on the pure pipeline: pointer events in, the frame loop with its time
 * budget, hit tests on real projected bodies, selection commits out. The clock is fake: each ray
 * the visibility test casts costs `RAY_MS`, each render between frames `RENDER_MS`, so the frame
 * slicing is deterministic. The host's selection follows the commits one render (frame) later.
 */

/** Front view, orthographic: 100 × 100 px, screen x = x + 50, screen y = 50 − y. */
const FRONT = [1 / 50, 0, 0, 0, 0, 1 / 50, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const SIZE = 100;
const RAY_MS = 3;
/** A support the model hides costs more rays than a visible one: every part and spot under the circle is tried. */
const HIDDEN_RAYS = 3;
const RENDER_MS = 10;

type Point = [number, number];

/** Support bodies as axis segments: contact `ids[i]` owns segments `first[i]` to `first[i + 1]`, 6 floats each. */
interface BodySegments {
  ids: string[];
  first: Uint32Array;
  points: Float32Array;
}

/** Squared distance between 2D segments ab and cd (0 when they cross). */
function segmentGap2(a: Point, b: Point, c: readonly [number, number], d: readonly [number, number]): number {
  const cross = (o: readonly [number, number], p: readonly [number, number], q: readonly [number, number]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  const toSegment = (p: readonly [number, number], u: readonly [number, number], v: readonly [number, number]) => {
    const lx = v[0] - u[0];
    const ly = v[1] - u[1];
    const length2 = lx * lx + ly * ly;
    const s = length2 > 0 ? Math.min(1, Math.max(0, ((p[0] - u[0]) * lx + (p[1] - u[1]) * ly) / length2)) : 0;
    return (u[0] + lx * s - p[0]) ** 2 + (u[1] + ly * s - p[1]) ** 2;
  };
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
}

/** A row of vertical supports (tip at plate y = 40, foot at 0), one per entry: id → plate x. */
function row(entries: Record<string, number>): BodySegments {
  const ids = Object.keys(entries);
  const first = new Uint32Array(ids.length + 1);
  const points = new Float32Array(ids.length * 12);
  ids.forEach((id, index) => {
    const x = entries[id]!;
    first[index] = index * 2;
    points.set([x, 40, 0, x, 36, 0, x, 36, 0, x, 0, 0], index * 12);
  });
  first[ids.length] = ids.length * 2;
  return { ids, first, points };
}

const PILLARS = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`s${index}`, -27.5 + index * 5]));

/**
 * The viewport's side of Drag over: the real pointer rules (`createDragOver`) and scheduler, with
 * the host's hit test, selection, clock and frames faked. Pointer events reach them only while
 * the host listens (a brush and supports to test). `log` records every selection commit and every
 * hover preview change, per frame.
 */
function rig(options: { bodies?: BodySegments; hidden?: (x: number) => boolean } = {}) {
  let clock = 0;
  let brush: Brush | undefined = { radius: 6, mode: 'select' };
  let bodies: BodySegments | undefined = options.bodies ?? row(PILLARS);
  let selection: ReadonlySet<string> = new Set();
  const committed = new Set<string>();
  let preview: readonly string[] = [];
  let frameNo = 0;
  let pendingFrame: (() => void) | undefined;
  const log: string[] = [];
  const hidden = options.hidden ?? (() => false);
  const stroke = createStroke();

  /** The host's hit test for one support mesh: its projection and its visibility cache. */
  const viewOf = (mesh: BodySegments): FrameTest => {
    // Front view: screen = (x + 50, 50 - y) in SIZE px. One ray per support settles its visibility for the stroke.
    const known = new Map<number, boolean>();
    const screen = (at: number): Point => [mesh.points[at]! + SIZE / 2, SIZE / 2 - mesh.points[at + 1]!];
    return (job, want, stop) => {
      const hits: string[] = [];
      const from: readonly [number, number] = job.from ?? job.to;
      for (let contact = job.next; contact < mesh.ids.length; contact++) {
        if (contact > job.next && stop()) return { hits, next: contact };
        const id = mesh.ids[contact]!;
        if (!want(id)) continue;
        let touched = false;
        for (let segment = mesh.first[contact]!; segment < mesh.first[contact + 1]!; segment++) {
          if (segmentGap2(screen(segment * 6), screen(segment * 6 + 3), from, job.to) <= job.radius * job.radius) touched = true;
        }
        if (!touched) continue;
        let visible = known.get(contact);
        if (visible === undefined) {
          const isHidden = hidden(mesh.points[mesh.first[contact]! * 6]!);
          clock += RAY_MS * (isHidden ? HIDDEN_RAYS : 1);
          known.set(contact, (visible = !isHidden));
        }
        if (visible) hits.push(id);
      }
      return { hits, next: mesh.ids.length };
    };
  };
  let view: FrameTest | undefined;
  const scheduler = createBrushScheduler({
    frame: () => view,
    isSelected: (id) => selection.has(id),
    commit: (ids, mode) => {
      log.push(`f${frameNo} ${mode} [${ids.join(' ')}]`);
      for (const id of ids) {
        if (mode === 'select') committed.add(id);
        else committed.delete(id);
      }
    },
    preview: (ids) => {
      preview = ids;
      log.push(`f${frameNo} preview [${ids.join(' ')}]`);
    },
    now: () => clock,
    requestFrame: (run) => {
      pendingFrame = run;
      return 1;
    },
    cancelFrame: () => {
      pendingFrame = undefined;
    },
  });
  /** The brush or the support mesh changed. */
  const update = () => {
    const mesh = brush ? bodies : undefined;
    view = mesh && viewOf(mesh);
    scheduler.setSupports(mesh?.ids.length);
  };
  update();

  const frame = () => {
    frameNo++;
    clock += RENDER_MS;
    const run = pendingFrame;
    pendingFrame = undefined;
    run?.();
    // React renders the committed selection before the next frame.
    selection = new Set(committed);
  };
  const dragOver = createDragOver(stroke, scheduler, () => {});
  /** True when the circle shows at `at`. */
  const move = (at: Point, held: boolean, onCanvas = true, onObject = true) => Boolean(view && brush && dragOver.move(at, { held, onCanvas, onObject }, brush));
  return {
    log,
    get selection() { return [...selection].sort(); },
    get preview() { return preview; },
    hover(at: Point) { return move(at, false); },
    offCanvas(at: Point) { return move(at, false, false); },
    /** Over the canvas but off the model and its supports. */
    overEmpty(at: Point) { return move(at, false, true, false); },
    /** A held move off the model (a stroke goes on; an orbit shows no circle). */
    dragOff(at: Point) { return move(at, true, true, false); },
    /** True when the circle still shows. */
    leave() { return Boolean(view && dragOver.leave()); },
    press(at: Point, onObject = true) { return Boolean(view && brush && dragOver.down(0, at, brush, onObject)); },
    drag(at: Point) { return move(at, true); },
    release() { stroke.end(); },
    /** A straight drag in `moves` pointer steps, one frame after each. */
    stroke(from: Point, to: Point, moves: number) {
      this.press(from);
      frame();
      for (let index = 1; index <= moves; index++) {
        this.drag([from[0] + ((to[0] - from[0]) * index) / moves, from[1] + ((to[1] - from[1]) * index) / moves]);
        frame();
      }
      this.release();
    },
    setMode(mode: BrushMode) { if (brush) brush = { ...brush, mode }; },
    setRadius(radius: number) { if (brush) brush = { ...brush, radius }; },
    brushOff() { brush = undefined; update(); },
    brushOn() { brush = { radius: 6, mode: 'select' }; update(); },
    supports(next: BodySegments | undefined) { bodies = next; update(); },
    frame,
    /** Frames until no work is left (a carried-over queue or hover drains). */
    settle() {
      for (let guard = 0; guard < 1000 && pendingFrame; guard++) frame();
      frame();
    },
  };
}

describe('Drag over: the stroke keeps the mode it started with', () => {

  it('an unselect stroke stays an unselect stroke when the brush turns to select halfway', () => {
    const view = rig();
    view.stroke([5, 30], [95, 30], 2);
    view.settle();
    expect(view.selection.length).toBe(12);
    view.setMode('unselect');
    view.press([5, 30]);
    view.frame();
    view.setMode('select');
    view.drag([50, 30]);
    view.frame();
    view.drag([95, 30]);
    view.release();
    view.settle();
    expect(view.selection).toEqual([]);
  });

  it('a select stroke stays a select stroke when the brush turns to unselect halfway', () => {
    const view = rig();
    view.press([5, 30]);
    view.frame();
    view.setMode('unselect');
    view.drag([50, 30]);
    view.frame();
    view.drag([95, 30]);
    view.release();
    view.settle();
    expect(view.selection.length).toBe(12);
    expect(view.log.some((line) => line.includes(' unselect '))).toBe(false);
  });

  it('a press on empty space starts no stroke whichever way the brush is set (an orbit, or a pan with Shift)', () => {
    const view = rig();
    for (const mode of ['select', 'unselect'] as const) {
      view.setMode(mode);
      expect(view.press([5, 30], false)).toBe(false);
      view.drag([95, 30]);
      view.release();
    }
    view.settle();
    expect(view.selection).toEqual([]);
    expect(view.log).toEqual([]);
  });
});

describe('Drag over pipeline (characterization)', () => {
  it('a hover previews the supports under the circle, sliced over frames', () => {
    const view = rig();
    view.setRadius(20);
    view.hover([50, 30]);
    view.settle();
    expect(view.preview).toEqual(['s2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(view.log).toMatchInlineSnapshot(`
      [
        "f1 preview [s2 s3 s4]",
        "f2 preview [s2 s3 s4 s5 s6 s7]",
        "f3 preview [s2 s3 s4 s5 s6 s7 s8 s9]",
      ]
    `);
  });

  it('a stroke paints every visible support it sweeps, committed per frame, finished after the release', () => {
    const view = rig({ hidden: (x) => x > 10 && x < 20 });
    view.hover([10, 30]);
    view.frame();
    view.stroke([10, 30], [90, 30], 4);
    expect(view.preview).toEqual([]);
    view.settle();
    expect(view.selection).toEqual(['s0', 's1', 's10', 's11', 's2', 's3', 's4', 's5', 's6', 's7']);
    expect(view.log).toMatchInlineSnapshot(`
      [
        "f3 select [s0 s1 s2]",
        "f4 select [s3 s4 s5]",
        "f5 select [s6 s7]",
        "f7 select [s10 s11]",
      ]
    `);
  });

  it('an Unselect stroke over a Select stroke still draining ends with those supports unselected', () => {
    const view = rig();
    view.stroke([5, 30], [95, 30], 2);
    view.setMode('unselect');
    view.setRadius(3);
    view.stroke([30, 30], [70, 30], 2);
    view.settle();
    expect(view.log).toMatchInlineSnapshot(`
      [
        "f2 select [s0 s1 s2]",
        "f3 select [s3 s4 s5]",
        "f4 select [s6 s7 s8]",
        "f5 select [s9 s10 s11]",
        "f6 unselect [s1 s2 s3 s4 s5 s6 s7 s8 s9 s10]",
      ]
    `);
    expect(view.selection).toMatchInlineSnapshot(`
      [
        "s0",
        "s11",
      ]
    `);
  });

  it('a support-mesh rebuild mid-stroke restarts the queued steps on the new supports', () => {
    const view = rig();
    view.stroke([5, 30], [95, 30], 3);
    const rebuilt = { ...PILLARS };
    delete rebuilt.s3;
    view.supports(row(Object.fromEntries(Object.entries(rebuilt).map(([id, x]) => [id === 's8' ? 'n8' : id, x]))));
    view.settle();
    expect(view.log).toMatchInlineSnapshot(`
      [
        "f2 select [s0 s1 s2]",
        "f3 select [s3 s4 s5]",
        "f4 select [s6 s7 s8]",
        "f5 select [n8 s9 s10]",
        "f6 select [s11]",
      ]
    `);
    expect(view.selection).toMatchInlineSnapshot(`
      [
        "n8",
        "s0",
        "s1",
        "s10",
        "s11",
        "s2",
        "s3",
        "s4",
        "s5",
        "s6",
        "s7",
        "s8",
        "s9",
      ]
    `);
  });

  it('Remove supports (an empty mesh) drops the queue: nothing runs on the next generated supports', () => {
    const view = rig();
    view.stroke([5, 30], [95, 30], 3);
    const before = view.log.length;
    view.supports(row({}));
    view.settle();
    view.supports(row(PILLARS));
    view.settle();
    expect(view.log.slice(before)).toEqual([]);
    expect(view.log).toMatchInlineSnapshot(`
      [
        "f2 select [s0 s1 s2]",
        "f3 select [s3 s4 s5]",
        "f4 select [s6 s7 s8]",
      ]
    `);
  });

  it('the brush going away drops the queue and the preview', () => {
    const view = rig();
    view.stroke([5, 30], [95, 30], 3);
    const before = view.log.length;
    view.brushOff();
    expect(view.preview).toEqual([]);
    view.brushOn();
    view.settle();
    expect(view.log.slice(before)).toEqual([]);
    view.setMode('unselect');
    view.hover([50, 30]);
    view.settle();
    expect(view.preview).toEqual(['s5', 's6']);
  });

  it('the support mesh going away mid-stroke drops the queue', () => {
    const view = rig();
    view.stroke([5, 30], [95, 30], 3);
    const before = view.log.length;
    view.supports(undefined);
    view.supports(row(PILLARS));
    view.settle();
    expect(view.log.slice(before)).toEqual([]);
  });

  it('leaving the canvas or moving off it clears the hover preview; a stroke keeps going off the canvas', () => {
    const view = rig();
    view.hover([50, 30]);
    view.settle();
    view.leave();
    expect(view.preview).toEqual([]);
    view.hover([50, 30]);
    view.settle();
    view.offCanvas([150, 30]);
    expect(view.preview).toEqual([]);
    view.press([5, 30]);
    view.drag([150, 30]);
    view.release();
    view.settle();
    expect(view.selection).toEqual(PILLARS && Object.keys(PILLARS).sort());
  });

  it('the circle hides off the canvas outside a stroke and follows the pointer through one', () => {
    const view = rig();
    expect(view.hover([50, 30])).toBe(true);
    expect(view.offCanvas([150, 30])).toBe(false);
    expect(view.leave()).toBe(false);
    view.press([5, 30]);
    expect(view.leave()).toBe(true);
    expect(view.drag([150, 30])).toBe(true);
    view.release();
    expect(view.offCanvas([150, 30])).toBe(false);
  });

  it('a press on empty space starts no stroke (the camera orbits), and the circle stays hidden over empty space and during an orbit', () => {
    const view = rig();
    expect(view.press([5, 30], false)).toBe(false);
    view.drag([60, 30]);
    view.release();
    view.settle();
    expect(view.selection).toEqual([]);
    expect(view.preview).toEqual([]);
    expect(view.overEmpty([50, 30])).toBe(false);
    expect(view.preview).toEqual([]);
    // Held without a stroke: an orbit that passes over the model shows no circle.
    expect(view.drag([50, 30])).toBe(false);
    expect(view.hover([50, 30])).toBe(true);
  });

  it('a stroke that started on the model keeps selecting after the pointer leaves it', () => {
    const view = rig();
    expect(view.press([5, 30], true)).toBe(true);
    expect(view.dragOff([95, 30])).toBe(true);
    view.release();
    view.settle();
    expect(view.selection.length).toBeGreaterThan(0);
  });
});
