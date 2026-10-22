import { describe, expect, it } from 'vitest';
import { createBrushScheduler, frameBudget, type Brush, type FrameTest } from './brushScheduler';
import type { BrushMode } from './types';

/**
 * A scheduler on a fake host: `total` supports `s0…`, each hit test costing `msPerSupport` of a
 * fake clock; every support under the circle is hit. Frames run only when the test calls `frame`.
 */
const BRUSH: Brush = { radius: 10, mode: 'select' };

function host(total: number, msPerSupport = 1) {
  let clock = 0;
  let pending: (() => void) | undefined;
  const state = {
    selected: new Set<string>(),
    projected: true,
    commits: [] as [string[], BrushMode][],
    previews: [] as string[][],
    /** Supports tested per frame. */
    tested: [] as number[],
    measured: [] as number[],
    requests: 0,
  };
  const test: FrameTest = (job, want, stop) => {
    const hits: string[] = [];
    for (let index = job.next; index < total; index++) {
      if (index > job.next && stop()) return { hits, next: index };
      clock += msPerSupport;
      state.tested[state.tested.length - 1]!++;
      if (want(`s${index}`)) hits.push(`s${index}`);
    }
    return { hits, next: total };
  };
  const scheduler = createBrushScheduler({
    frame: () => (state.projected ? test : undefined),
    isSelected: (id) => state.selected.has(id),
    commit: (ids, mode) => state.commits.push([[...ids], mode]),
    preview: (ids) => state.previews.push([...ids]),
    now: () => clock,
    requestFrame: (run) => {
      state.requests++;
      pending = run;
      return state.requests;
    },
    cancelFrame: () => {
      pending = undefined;
    },
    measure: (started) => state.measured.push(started),
  });
  scheduler.setSupports(total);
  return {
    scheduler,
    state,
    get scheduled() { return pending !== undefined; },
    /** Rendering took `renderMs`, then the next animation frame runs. */
    frame(renderMs = 10) {
      clock += renderMs;
      state.tested.push(0);
      const run = pending;
      pending = undefined;
      run?.();
    },
  };
}

describe('frameBudget', () => {
  it('is 8 ms when rendering fills a 60 Hz frame, more when rendering is cheap or frames are long anyway, capped', () => {
    expect(frameBudget(8.7)).toBe(8);
    expect(frameBudget(2)).toBeCloseTo(1000 / 60 - 2, 9);
    // Software rendering at ~320 ms a frame: a quarter of it more for hit tests hardly changes the frame rate.
    expect(frameBudget(320)).toBe(80);
    expect(frameBudget(2000)).toBe(100);
    expect(frameBudget(Number.NaN)).toBe(8);
  });
});

describe('brush scheduler (Drag over frame loop)', () => {
  it('requests no frame while there is nothing to test', () => {
    const view = host(10);
    expect(view.scheduled).toBe(false);
    view.scheduler.press();
    expect(view.scheduled).toBe(false);
  });

  it('runs a frame\'s hit tests within the budget and carries the rest over to the next frames', () => {
    const view = host(40);
    view.scheduler.press();
    view.scheduler.sample([0, 0], BRUSH);
    while (view.scheduled) view.frame();
    // 10 ms renders leave under 8 ms of a 60 Hz frame: the 8 ms floor holds.
    expect(view.state.tested).toEqual([9, 9, 9, 9, 4]);
    expect(view.state.commits.flatMap(([ids]) => ids)).toHaveLength(40);
    expect(view.state.measured).toHaveLength(5);
  });

  it('gives the hit tests more time per frame when frames are long anyway (software GL), up to 100 ms', () => {
    const view = host(5000);
    view.scheduler.press();
    view.scheduler.sample([0, 0], BRUSH);
    for (let index = 0; index < 30; index++) view.frame(400);
    const tested = view.state.tested;
    expect(tested.slice(0, 4)).toEqual([9, 32, 52, 67]);
    for (let index = 1; index < tested.length; index++) expect(tested[index]!).toBeGreaterThanOrEqual(tested[index - 1]!);
    expect(tested[tested.length - 1]).toBe(100);
  });

  it('does not count an idle pause between frames as render time', () => {
    const view = host(40);
    view.scheduler.press();
    view.scheduler.sample([0, 0], BRUSH);
    view.frame();
    view.frame(5000);
    expect(view.state.tested).toEqual([9, 9]);
  });

  it('a hover previews what the circle would change, found so far, frame by frame', () => {
    const view = host(20, 4);
    view.state.selected = new Set(['s1']); // Select previews only what it would add
    view.scheduler.hover([5, 5], BRUSH);
    while (view.scheduled) view.frame();
    expect(view.state.previews.map((ids) => ids.length)).toEqual([2, 5, 8, 11, 14, 17, 19]);
    expect(view.state.previews.at(-1)).not.toContain('s1');
    view.scheduler.clearHover();
    expect(view.state.previews.at(-1)).toEqual([]);
  });

  it('a press drops the hover and its preview; the stroke wins the frame', () => {
    const view = host(20, 4);
    view.scheduler.hover([5, 5], BRUSH);
    view.frame();
    view.scheduler.press();
    expect(view.state.previews.at(-1)).toEqual([]);
    view.scheduler.sample([5, 5], BRUSH);
    while (view.scheduled) view.frame();
    expect(view.state.previews).toHaveLength(2);
    expect(view.state.commits.flatMap(([ids]) => ids)).toHaveLength(20);
  });

  it('a frame with no projection yet tests nothing and tries again next frame', () => {
    const view = host(10);
    view.state.projected = false;
    view.scheduler.press();
    view.scheduler.sample([0, 0], BRUSH);
    view.frame();
    expect(view.state.commits).toEqual([]);
    expect(view.scheduled).toBe(true);
    view.state.projected = true;
    view.frame();
    expect(view.state.commits).toHaveLength(1);
  });

  it('new supports restart the queued samples on them; none (or an empty mesh) drops them', () => {
    const view = host(40);
    view.scheduler.press();
    view.scheduler.sample([0, 0], BRUSH);
    view.frame();
    view.scheduler.setSupports(40);
    expect(view.scheduled).toBe(true);
    while (view.scheduled) view.frame();
    expect(view.state.tested.reduce((sum, count) => sum + count, 0)).toBe(49);

    for (const gone of [undefined, 0]) {
      view.scheduler.press();
      view.scheduler.sample([0, 0], BRUSH);
      view.scheduler.setSupports(gone);
      expect(view.scheduled).toBe(false);
      view.scheduler.setSupports(40);
      expect(view.scheduled).toBe(false);
    }
  });
});
