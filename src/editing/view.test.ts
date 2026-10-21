import { describe, expect, it } from 'vitest';
import { fitDirection } from './view';

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
