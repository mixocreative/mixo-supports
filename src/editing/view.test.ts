import { describe, expect, it } from 'vitest';
import { belowPlate, boundsSphere, fitDirection, frameView, FRAME_MARGIN, MIN_SPOT_RADIUS, spotView, TIPS_START, tipsCamera, tipsShown, tipsToggle, type TipsState } from './view';

const horizontal = ([x, , z]: number[]) => Math.hypot(x!, z!);

describe('fitDirection', () => {
  it('keeps an ordinary viewing direction, normalised', () => {
    const [x, y, z] = fitDirection([3, 4, 12]);
    expect([x, y, z].map((value) => value * 13)).toEqual([3, 4, 12].map((value) => expect.closeTo(value, 12)));
  });

  it('tilts a straight-down or straight-up view a hair, front of the plate at the bottom', () => {
    for (const y of [50, -50]) {
      const direction = fitDirection([0, y, 0]);
      expect(Math.hypot(...direction)).toBeCloseTo(1, 12);
      expect(Math.sign(direction[1])).toBe(Math.sign(y));
      expect(direction[2]).toBeGreaterThan(0);
      expect(horizontal(direction)).toBeGreaterThanOrEqual(0.999e-3);
    }
    // Nearly vertical counts too.
    expect(horizontal(fitDirection([1e-6, 1, -1e-6]))).toBeGreaterThanOrEqual(0.999e-3);
  });

  it('falls back to the start view when the camera sits on its target', () => {
    const [x, y, z] = fitDirection([0, 0, 0]);
    const length = Math.hypot(70, 60, 90);
    expect([x, y, z]).toEqual([70 / length, 60 / length, 90 / length]);
  });
});

describe('frameView', () => {
  const bounds = { center: [10, 5, -2] as [number, number, number], radius: 20 };
  const distance = 20 / Math.sin(40 * (Math.PI / 180) / 2) * FRAME_MARGIN;

  it('Bottom view looks straight up from below, a hair off vertical, front of the plate at the bottom', () => {
    const view = frameView(bounds, 40, 'bottom');
    expect(view.target).toEqual([10, 5, -2]);
    expect(view.position).toEqual([10, 5 - distance, -2 + distance * 1e-3]);
  });

  it('Fit view keeps the current viewing direction at the framing distance', () => {
    const view = frameView(bounds, 40, 'fit', { position: [3, 4, 12], target: [0, 0, 0] });
    expect(view.target).toEqual([10, 5, -2]);
    const offset = view.position.map((value, axis) => value - bounds.center[axis]!);
    expect(Math.hypot(...offset)).toBeCloseTo(distance, 9);
    offset.forEach((value, axis) => expect(value / distance).toBeCloseTo([3, 4, 12][axis]! / 13, 12));
  });

  it('Fit view with the camera on its target falls back to the start view direction', () => {
    const view = frameView(bounds, 40, 'fit', { position: [1, 1, 1], target: [1, 1, 1] });
    const offset = view.position.map((value, axis) => (value - bounds.center[axis]!) / distance);
    const length = Math.hypot(70, 60, 90);
    offset.forEach((value, axis) => expect(value).toBeCloseTo([70, 60, 90][axis]! / length, 12));
  });

  it('frames a tiny object as if it were 1 mm across', () => {
    const view = frameView({ center: [0, 0, 0], radius: 0.01 }, 40, 'bottom');
    expect(view.position[1]).toBeCloseTo(-(1 / Math.sin((20 * Math.PI) / 180)) * FRAME_MARGIN, 12);
  });
});

describe('spotView (Show me on a check finding)', () => {
  it('frames the spot from the current direction, close enough to see it', () => {
    const view = spotView([5, 5, 5], 0, 40, { position: [0, 0, 100], target: [0, 0, 0] });
    expect(view.target).toEqual([5, 5, 5]);
    // An island (no area) is framed as a 10 mm wide spot.
    const distance = MIN_SPOT_RADIUS / Math.sin(40 * (Math.PI / 180) / 2) * FRAME_MARGIN;
    expect(view.position[0]).toBeCloseTo(5, 12);
    expect(view.position[1]).toBeCloseTo(5, 12);
    expect(view.position[2]).toBeCloseTo(5 + distance, 9);
  });

  it('frames a larger overhang wider', () => {
    const small = spotView([0, 0, 0], 4, 40, { position: [0, 0, 100], target: [0, 0, 0] });
    const large = spotView([0, 0, 0], 400, 40, { position: [0, 0, 100], target: [0, 0, 0] });
    expect(large.position[2]).toBeCloseTo(20 / Math.sin(40 * (Math.PI / 180) / 2) * FRAME_MARGIN, 9);
    expect(large.position[2]).toBeGreaterThan(small.position[2]);
  });
});

describe('boundsSphere', () => {
  it('is the sphere around a box: centre and half the diagonal', () => {
    expect(boundsSphere({ min: [0, 0, 0], max: [2, 4, 4] })).toEqual({ center: [1, 2, 2], radius: 3 });
  });
});

describe('belowPlate', () => {
  it('is true only with the camera under y = 0', () => {
    expect(belowPlate(-0.001)).toBe(true);
    expect(belowPlate(0)).toBe(false);
    expect(belowPlate(10)).toBe(false);
  });
});

describe('Tips only (tipsShown, tipsCamera, tipsToggle)', () => {
  const at = (manual: boolean | null, below: boolean): TipsState => ({ manual, below });

  it('starts above the plate, following the camera, tips off', () => {
    expect(TIPS_START).toEqual({ manual: null, below: false });
    expect(tipsShown(TIPS_START)).toBe(false);
  });

  it('shows the manual choice when there is one, else turns on by itself below the plate', () => {
    const table: [TipsState, boolean, boolean][] = [
      // state, auto-on above the plate (large model), shown
      [at(null, false), false, false],
      [at(null, true), false, true],
      [at(true, false), false, true],
      [at(false, true), false, false],
      [at(true, true), false, true],
      [at(false, false), false, false],
      [at(null, false), true, true],
      [at(false, false), true, false],
    ];
    for (const [state, autoAbove, shown] of table) expect(tipsShown(state, autoAbove), JSON.stringify([state, autoAbove])).toBe(shown);
  });

  it('painting zones forces the tips view (both ends of every support show over the blue layer) without touching the choice', () => {
    const table: [TipsState, boolean, boolean][] = [
      // state, painting zones, shown
      [at(false, false), true, true],
      [at(false, true), true, true],
      [at(null, false), true, true],
      [at(false, false), false, false],
      [at(true, false), false, true],
    ];
    for (const [state, zones, shown] of table) expect(tipsShown(state, false, zones), JSON.stringify([state, zones])).toBe(shown);
    // Leaving zones mode: the state was never changed, so the previous view comes back.
    const before = at(false, true);
    expect(tipsShown(before, false, true)).toBe(true);
    expect(tipsShown(before, false, false)).toBe(false);
  });

  it('crossing the plate (either way) hands the choice back to the camera; staying on one side keeps it', () => {
    const table: [TipsState, boolean, TipsState][] = [
      [at(false, true), false, at(null, false)],
      [at(true, false), true, at(null, true)],
      [at(false, false), true, at(null, true)],
      [at(true, true), false, at(null, false)],
      [at(false, true), true, at(false, true)],
      [at(true, false), false, at(true, false)],
    ];
    for (const [state, below, next] of table) expect(tipsCamera(state, below), JSON.stringify([state, below])).toEqual(next);
    const same = at(false, true);
    expect(tipsCamera(same, true)).toBe(same);
  });

  it('a click always flips what shows, also below the plate (the button is never disabled)', () => {
    const table: [TipsState, boolean, TipsState][] = [
      [at(null, false), false, at(true, false)],
      [at(null, true), false, at(false, true)],
      [at(false, true), false, at(true, true)],
      [at(true, false), false, at(false, false)],
      [at(null, false), true, at(false, false)],
    ];
    for (const [state, autoAbove, next] of table) expect(tipsToggle(state, autoAbove), JSON.stringify([state, autoAbove])).toEqual(next);
  });

  it('what shows and what a click leaves, over every state, large model and zones (table)', () => {
    const rows: string[] = [];
    for (const manual of [null, true, false]) for (const below of [false, true]) for (const large of [false, true]) for (const zones of [false, true]) {
      const state = at(manual, below);
      const next = tipsToggle(state, large);
      rows.push(`${manual} ${below} ${large} ${zones} -> ${tipsShown(state, large, zones)} ${next.manual} ${next.below}`);
    }
    expect(rows).toEqual([
      'null false false false -> false true false', 'null false false true -> true true false',
      'null false true false -> true false false', 'null false true true -> true false false',
      'null true false false -> true false true', 'null true false true -> true false true',
      'null true true false -> true false true', 'null true true true -> true false true',
      'true false false false -> true false false', 'true false false true -> true false false',
      'true false true false -> true false false', 'true false true true -> true false false',
      'true true false false -> true false true', 'true true false true -> true false true',
      'true true true false -> true false true', 'true true true true -> true false true',
      'false false false false -> false true false', 'false false false true -> true true false',
      'false false true false -> false true false', 'false false true true -> true true false',
      'false true false false -> false true true', 'false true false true -> true true true',
      'false true true false -> false true true', 'false true true true -> true true true',
    ]);
  });

  it('walks the owner story: Bottom view turns tips on, a click turns them off, Fit view keeps them off, orbiting above and back turns them on again', () => {
    let state = TIPS_START;
    state = tipsToggle(state); // on above the plate
    expect(tipsShown(state)).toBe(true);
    state = tipsToggle(state); // and off again
    expect(tipsShown(state)).toBe(false);
    state = tipsCamera(state, true); // Bottom view
    expect(tipsShown(state)).toBe(true);
    state = tipsToggle(state); // switched off below the plate
    expect(tipsShown(state)).toBe(false);
    state = tipsCamera(state, true); // Fit view keeps the angle below
    expect(tipsShown(state)).toBe(false);
    state = tipsCamera(tipsCamera(state, false), true); // above, then below again
    expect(tipsShown(state)).toBe(true);
  });
});
