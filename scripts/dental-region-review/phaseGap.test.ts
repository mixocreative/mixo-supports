import { describe, expect, it } from 'vitest';
import { unresolvedCircularArcs } from './phaseGap';

describe('unresolvedCircularArcs', () => {
  it('reports alternate samples only inside oversized retained-contact gaps, including wraparound', () => {
    const arcs = unresolvedCircularArcs(10, [2, 8], [
      { atMm: 3, face: 4 }, { atMm: 9, face: 5 }, { atMm: 1, face: 6 },
    ], 3);
    expect(arcs).toEqual([
      { fromMm: 2, toMm: 8, gapMm: 6, candidates: [{ atMm: 3, face: 4 }] },
      { fromMm: 8, toMm: 12, gapMm: 4, candidates: [{ atMm: 9, face: 5 }, { atMm: 1, face: 6 }] },
    ]);
  });

  it('treats zero retained contacts as an unresolved full loop', () => {
    expect(unresolvedCircularArcs(10, [], [{ atMm: 3, face: 4 }], 4)).toEqual([
      { fromMm: 0, toMm: 10, gapMm: 10, candidates: [{ atMm: 3, face: 4 }] },
    ]);
  });
});
