import { describe, expect, it } from 'vitest';
import { acosf } from './acosf';

describe('acosf', () => {
  it('handles the end points and out-of-range input', () => {
    expect(acosf(1)).toBe(0);
    expect(acosf(-1)).toBe(Math.fround(Math.PI));
    expect(acosf(0)).toBe(Math.fround(Math.PI / 2));
    expect(acosf(1.5)).toBeNaN();
  });

  it('is within one single-precision ulp of the exact arccos across [-1, 1]', () => {
    for (let n = 0; n <= 20000; n += 1) {
      const x = Math.fround(-1 + n / 10000);
      const exact = Math.acos(x);
      const ulp = 2 ** (Math.floor(Math.log2(exact || 1)) - 23);
      expect(Math.abs(acosf(x) - exact)).toBeLessThanOrEqual(ulp);
    }
  });
});
