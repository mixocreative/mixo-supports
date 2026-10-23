import { describe, expect, it } from 'vitest';
import { appendSurfaceStamps } from './surfaceBrush';

describe('surface brush stamps', () => {
  it('copies one unit-local hit into an ordered stamp', () => {
    const point: [number, number, number] = [1, 2, 3];
    const normal: [number, number, number] = [0, -1, 0];
    const stamps = appendSurfaceStamps('allow', 2, [{ point, normal }]);
    expect(stamps).toEqual([
      { center: [1, 2, 3], normal: [0, -1, 0], radius: 2, kind: 'allow' },
    ]);
    point[0] = 99;
    expect(stamps[0]!.center).toEqual([1, 2, 3]);
  });

  it('rejects a radius that cannot produce a surface stamp', () => {
    expect(() => appendSurfaceStamps('paint', 0, [])).toThrow(RangeError);
  });
});
