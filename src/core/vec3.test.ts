import { describe, expect, it } from 'vitest';
import { add, cross, distance, distanceSq, dot, length, lengthSq, normalize, scale, subtract } from './vec3';

describe('vec3', () => {
  it('does component-wise arithmetic', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(subtract([1, 2, 3], [4, 6, 8])).toEqual([-3, -4, -5]);
    expect(scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
  });

  it('gives dot and right-handed cross products', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(cross([0, 1, 0], [0, 0, 1])).toEqual([1, 0, 0]);
  });

  it('measures lengths and distances', () => {
    expect(length([3, 4, 12])).toBe(13);
    expect(lengthSq([3, 4, 12])).toBe(169);
    expect(distance([1, 1, 1], [4, 5, 13])).toBe(13);
    expect(distanceSq([1, 1, 1], [4, 5, 13])).toBe(169);
  });

  it('normalizes, with a caller-chosen result for zero length', () => {
    expect(normalize([0, 3, 4])).toEqual([0, 0.6, 0.8]);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
    expect(normalize([0, 0, 0], [0, -1, 0])).toEqual([0, -1, 0]);
  });

  it('returns a new tuple each call', () => {
    const v: [number, number, number] = [1, 2, 3];
    expect(add(v, [0, 0, 0])).not.toBe(v);
    expect(normalize([0, 0, 0])).not.toBe(normalize([0, 0, 0]));
  });
});
