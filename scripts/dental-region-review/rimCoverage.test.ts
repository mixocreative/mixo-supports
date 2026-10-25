import { describe, expect, it } from 'vitest';
import { largestCircularGap } from './rimCoverage';

describe('largestCircularGap', () => {
  it('includes the wraparound gap on a closed rim', () => {
    expect(largestCircularGap(20, [2, 6, 10, 14])).toBe(8);
  });

  it('reports an entirely unsupported rim', () => {
    expect(largestCircularGap(20, [])).toBe(20);
  });
});
