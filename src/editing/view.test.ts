import { describe, expect, it } from 'vitest';
import { belowPlate, boundsSphere, fitDirection, focusView, frameView, FRAME_MARGIN, tipsView } from './view';

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

describe('focusView', () => {
  it('turns to the point keeping the viewing direction, no farther than 60 mm', () => {
    const near = focusView([5, 5, 5], { position: [0, 0, 10], target: [0, 0, 0] });
    expect(near).toEqual({ position: [5, 5, 15], target: [5, 5, 5] });
    const far = focusView([0, 0, 0], { position: [0, 300, 400], target: [0, 0, 0] });
    expect(far.position[0]).toBe(0);
    expect(far.position[1]).toBeCloseTo(36, 12);
    expect(far.position[2]).toBeCloseTo(48, 12);
  });
});

describe('boundsSphere', () => {
  it('is the sphere around a box: centre and half the diagonal', () => {
    expect(boundsSphere({ min: [0, 0, 0], max: [2, 4, 4] })).toEqual({ center: [1, 2, 2], radius: 3 });
  });
});

describe('belowPlate and tipsView', () => {
  it('shows only the tips from below the plate or when asked', () => {
    expect(belowPlate(-0.001)).toBe(true);
    expect(belowPlate(0)).toBe(false);
    expect(belowPlate(10)).toBe(false);
    expect(tipsView(false, false)).toBe(false);
    expect(tipsView(true, false)).toBe(true);
    expect(tipsView(false, true)).toBe(true);
  });
});
