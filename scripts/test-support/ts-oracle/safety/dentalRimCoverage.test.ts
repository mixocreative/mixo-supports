import { describe, expect, it } from 'vitest';
import { measureDentalRimCoverage } from './dentalRimCoverage';

describe('measureDentalRimCoverage', () => {
  it('measures final retained gaps across the seam of each closed rim', () => {
    const result = measureDentalRimCoverage([
      { rim: 'outer', perimeterMm: 20, spacingMm: 3, retainedAtMm: [1, 4, 7, 10, 13, 16, 19] },
      { rim: 'opening', perimeterMm: 20, spacingMm: 2, retainedAtMm: [1, 3, 5, 15, 17, 19] },
    ]);
    expect(result.outer.maxGapMm).toBe(3);
    expect(result.outer.needsReview).toBe(false);
    expect(result.opening.maxGapMm).toBe(10);
    expect(result.opening.needsReview).toBe(true);
  });

  it('flags an entirely unsupported rim rather than treating it as complete', () => {
    const result = measureDentalRimCoverage([
      { rim: 'outer', perimeterMm: 12, spacingMm: 3, retainedAtMm: [] },
      { rim: 'opening', perimeterMm: 8, spacingMm: 2, retainedAtMm: [] },
    ]);
    expect(result.outer.maxGapMm).toBe(12);
    expect(result.opening.maxGapMm).toBe(8);
    expect(result.needsReview).toBe(true);
  });
});
