import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import { createModelCollisionIndex } from './modelCollisionIndex';
import type { SupportRoute } from './supportRoute';
import { screenColumnRoutes } from './columnPathScreen';

const shelf: TriangleMesh = {
  positions: new Float32Array([-3, 5, -3, 3, 5, -3, 0, 5, 3]),
  indices: new Uint32Array([0, 1, 2]),
};
const index = createModelCollisionIndex(shelf);
const route = (part: SupportRoute['part'], points: SupportRoute['points'], uncertainEndMm?: number): SupportRoute =>
  ({ part, points, radiusMm: 0.4, ...(uncertainEndMm === undefined ? {} : { uncertainEndMm }) });

describe('screenColumnRoutes', () => {
  it('flags a definite shaft crossing before the column is built', () => {
    expect(screenColumnRoutes(index, [route('neck', [[0, 10, 0], [0, 8, 0]]),
      route('pillar', [[0, 8, 0], [0, 0, 0]])]))
      .toEqual({ status: 'blocked', part: 'pillar', modelFaceIndex: 0 });
  });

  it('does not delete a column for a neck-only contact hit', () => {
    expect(screenColumnRoutes(index, [route('neck', [[0, 8, 0], [0, 2, 0]]),
      route('pillar', [[8, 8, 0], [8, 0, 0]])]).status).toBe('defer');
  });

  it('defers an intentional far-end landing rather than treating it as a blocked shaft', () => {
    expect(screenColumnRoutes(index, [route('pillar', [[0, 10, 0], [0, 4.8, 0]], 1)])).toEqual({
      status: 'defer', reason: 'contact-reach',
    });
  });

  it('finds a separate wall before an intentional landing', () => {
    const twoShelves: TriangleMesh = {
      positions: new Float32Array([
        -3, 7, -3, 3, 7, -3, 0, 7, 3,
        -3, 5, -3, 3, 5, -3, 0, 5, 3,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    expect(screenColumnRoutes(createModelCollisionIndex(twoShelves),
      [route('pillar', [[0, 10, 0], [0, 4.8, 0]], 1)]))
      .toEqual({ status: 'blocked', part: 'pillar', modelFaceIndex: 0 });
  });

  it('defers cancellation and envelope-only proximity without claiming safety', () => {
    expect(screenColumnRoutes(index, [route('pillar', [[-0.5, 5.3, 0], [0.5, 5.3, 0]])]).status)
      .toBe('defer');
    expect(screenColumnRoutes(index, [route('pillar', [[0, 8, 0], [0, 0, 0]])], () => true))
      .toEqual({ status: 'defer', reason: 'cancelled' });
  });
});
