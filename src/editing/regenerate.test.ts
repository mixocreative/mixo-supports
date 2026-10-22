import { describe, expect, it } from 'vitest';
import type { SupportPoint } from '../core/analysis/types';
import { positionId } from '../core/analysis/placement';
import type { Vector } from '../core/vec3';
import { regenReport, regeneratedStatus, regeneratingStatus } from './regenerate';

const at = (position: Vector): SupportPoint => ({ id: positionId(position), regionId: 0, position, normal: [0, -1, 0], source: 'interior' });

describe('regenReport', () => {
  const placed = [at([0, 0, 0]), at([10, 0, 0]), at([20, 0, 0])];

  it('keeps the added supports and counts removals by what became of them', () => {
    // One removal names a contact that is placed again, one moved a little (re-matched), one has no neighbour left.
    const deleted = [placed[0]!.id, positionId([10.4, 0, 0]), positionId([50, 0, 0])];
    expect(regenReport(4, deleted, placed, 1.5)).toEqual({ added: 4, removed: 2, reset: 1 });
  });

  it('is all zeros for an object with no hand work', () => {
    expect(regenReport(0, [], placed, 1.5)).toEqual({ added: 0, removed: 0, reset: 0 });
  });
});

describe('regeneration statuses', () => {
  it('names the object or the count, and says a placement change did it', () => {
    expect(regeneratingStatus({ n: 1, name: 'bust' }, 'button')).toMatchObject({ key: 'Regenerating {name}.', vars: { n: 1, name: 'bust' } });
    expect(regeneratingStatus({ n: 3, name: 'bust' }, 'placement').other).toBe('Placement changed: regenerating {n} objects.');
  });

  it('reports hand work only when there was some', () => {
    expect(regeneratedStatus('bust', 40, { added: 0, removed: 0, reset: 0 }).key).toBe('{name}: {n} automatic contacts generated.');
    expect(regeneratedStatus('bust', 40, { added: 2, removed: 3, reset: 1 })).toMatchObject({ vars: { name: 'bust', n: 40, added: 2, removed: 3, reset: 1 } });
  });
});
