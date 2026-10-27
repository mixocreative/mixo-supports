import { describe, expect, it } from 'vitest';
import { islandProblems } from './islandProblems';

const positions = new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6]);

describe('islandProblems', () => {
  it('lists only unresolved islands, at their vertex', () => {
    const report = { status: 'ok' as const, islands: [
      { height: 0, vertex: 1, status: 'unresolved' as const },
      { height: 1, vertex: 2, status: 'resolved' as const },
      { height: 2, vertex: 0, status: 'manual-only' as const },
    ] };
    expect(islandProblems(report, positions)).toEqual([{ kind: 'island', position: [1, 2, 3], area: 0 }]);
  });
  it('turns an inconclusive verdict into one unjudged entry, never a clear list', () => {
    expect(islandProblems({ status: 'inconclusive', reason: 'non-manifold' }, positions)).toEqual([{ kind: 'unjudged', position: [0, 0, 0], area: 0 }]);
  });
  it('lists nothing without a verdict, and skips a vertex that is not in the mesh', () => {
    expect(islandProblems(undefined, positions)).toEqual([]);
    expect(islandProblems({ status: 'ok', islands: [{ height: 0, vertex: 9, status: 'unresolved' }] }, positions)).toEqual([]);
  });
  it('collapses outside-policy islands into one informational entry, keeping unresolved ones as they are', () => {
    const report = { status: 'ok' as const, islands: [
      { height: 0, vertex: 1, status: 'outside-policy' as const },
      { height: 1, vertex: 0, status: 'unresolved' as const },
      { height: 2, vertex: 2, status: 'outside-policy' as const },
    ] };
    expect(islandProblems(report, positions)).toEqual([
      { kind: 'island', position: [0, 0, 0], area: 0 },
      { kind: 'outside', position: [1, 2, 3], area: 0, points: [[1, 2, 3], [4, 5, 6]] },
    ]);
  });
  it('lists no outside entry when no island is outside the policy', () => {
    expect(islandProblems({ status: 'ok', islands: [{ height: 0, vertex: 1, status: 'resolved' }] }, positions)).toEqual([]);
  });
});
