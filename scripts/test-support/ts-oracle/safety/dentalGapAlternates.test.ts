import { describe, expect, it } from 'vitest';
import { selectDentalGapAlternates } from './dentalGapAlternates';

const candidate = (at: number, face: number) => ({ distanceAlongContour: at, face });

describe('selectDentalGapAlternates', () => {
  it('chooses one midpoint-near alternate from each oversized retained-contact gap', () => {
    const options = [candidate(3, 30), candidate(5, 50), candidate(7, 70),
      candidate(11, 110), candidate(13, 130), candidate(15, 150), candidate(19, 190)];
    expect(selectDentalGapAlternates(20, [1, 9, 17], options, 4).map(({ face }) => face))
      .toEqual([50, 130]);
  });

  it('handles the closed-loop seam and does not select a retained position', () => {
    const options = [candidate(1, 10), candidate(3, 30), candidate(17, 170), candidate(19, 190)];
    expect(selectDentalGapAlternates(20, [3, 17], options, 5).map(({ face }) => face))
      .toEqual([190]);
  });

  it('returns no repair when the measurements are invalid or gaps have no alternate', () => {
    expect(selectDentalGapAlternates(0, [1], [candidate(2, 20)], 4)).toEqual([]);
    expect(selectDentalGapAlternates(20, [1, 9, 17], [candidate(1, 10)], 4)).toEqual([]);
    expect(selectDentalGapAlternates(20, [1, 9, 17], [candidate(Number.NaN, 10)], 4)).toEqual([]);
  });
});
