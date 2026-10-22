import { describe, expect, it } from 'vitest';
import { contactVertexRuns, selectionDelta } from './selectionPaint';

describe('selectionDelta', () => {
  it('lists only what turned on and what turned off', () => {
    expect(selectionDelta(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual({ on: ['c'], off: ['a'] });
    expect(selectionDelta(new Set(['a']), new Set(['a']))).toEqual({ on: [], off: [] });
  });
});

describe('contactVertexRuns', () => {
  it('maps each contact to the vertex ranges of its parts, merging touching ones, skipping parts of no contact', () => {
    // Vertices 0-3 tip of a, 4-7 pillar of a, 8-10 brace (no contact), 11-13 tip of b.
    const indices = new Uint32Array([0, 1, 2, 1, 2, 3, 4, 5, 6, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const components = [
      { part: 'tip' as const, contactId: 'a', start: 0, count: 6 },
      { part: 'pillar' as const, contactId: 'a', start: 6, count: 6 },
      { part: 'brace' as const, start: 12, count: 3 },
      { part: 'tip' as const, contactId: 'b', start: 15, count: 3 },
    ];
    const runs = contactVertexRuns({ indices, components });
    expect(runs.get('a')).toEqual([[0, 8]]);
    expect(runs.get('b')).toEqual([[11, 14]]);
    expect(runs.size).toBe(2);
  });
});
