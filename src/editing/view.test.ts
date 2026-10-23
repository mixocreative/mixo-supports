import { describe, expect, it } from 'vitest';
import { belowPlate, boundsSphere, fitDirection, frameView, FRAME_MARGIN, MIN_SPOT_RADIUS, spotView, TIPS_START, tipsCamera, tipsButton, tipsPress, type TipsState } from './view';

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

describe('Tips only (tipsButton, tipsCamera, tipsPress)', () => {
  const PLAIN = { zones: false };
  const shown = (state: TipsState, zones = false) => tipsButton(state, { zones }).shown;

  it('starts off: full supports above the plate', () => {
    expect(TIPS_START).toEqual({ above: false, belowChoice: null, below: false });
    expect(shown(TIPS_START)).toBe(false);
  });

  it('going under the plate shows the tips; coming back up restores whatever was chosen above', () => {
    for (const above of [false, true]) {
      let state: TipsState = { ...TIPS_START, above };
      state = tipsCamera(state, true);
      expect(shown(state), `below, above=${above}`).toBe(true);
      state = tipsCamera(state, false);
      expect(shown(state), `back up, above=${above}`).toBe(above);
    }
  });

  it('a press below the plate switches the tips off there only, and is forgotten after coming back up', () => {
    let state = tipsCamera(TIPS_START, true);
    state = tipsPress(state, PLAIN);
    expect(shown(state)).toBe(false);
    state = tipsCamera(state, true);
    expect(shown(state)).toBe(false);
    state = tipsCamera(state, false);
    expect(shown(state)).toBe(false);
    expect(state.above).toBe(false);
    state = tipsCamera(state, true);
    expect(shown(state)).toBe(true);
  });

  it('a press above the plate is the choice restored after every trip under it', () => {
    let state = tipsPress(TIPS_START, PLAIN);
    expect(shown(state)).toBe(true);
    state = tipsCamera(tipsCamera(state, true), false);
    expect(shown(state)).toBe(true);
    state = tipsPress(state, PLAIN);
    state = tipsCamera(tipsCamera(state, true), false);
    expect(shown(state)).toBe(false);
  });

  it('the same side again changes nothing', () => {
    const state = tipsCamera(TIPS_START, true);
    expect(tipsCamera(state, true)).toBe(state);
  });

  it('painting zones forces the tips view, ignores presses and leaves the choice untouched', () => {
    const ZONES_HINT = 'While painting no-support zones only the contact tips show, so the surface stays visible.';
    for (const state of [TIPS_START, { ...TIPS_START, above: true }, tipsCamera(TIPS_START, true)]) {
      expect(tipsButton(state, { zones: true })).toEqual({ shown: true, forced: true, hint: ZONES_HINT });
      expect(tipsPress(state, { zones: true })).toBe(state);
    }
    expect(shown(TIPS_START)).toBe(false);
  });

  it('hints follow what shows', () => {
    expect(tipsButton(TIPS_START, PLAIN).hint).toBe('Show only the contact tips: no pillars, braces or raft. Turns on by itself below the plate. Export stays full.');
    expect(tipsButton(tipsCamera(TIPS_START, true), PLAIN).hint).toBe('Only contact tips show. Turns on by itself below the plate; click to switch off. Export stays full.');
  });
});
