import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportPoint } from '../core/analysis/types';
import { positionId, rekeyHandWork } from '../../scripts/test-support/ts-oracle/placement/placement';
import type { Vector } from '../core/vec3';
import { REGENERATE_DELAY_MS, RegenerateQueue, hasHandWork, landedStatus, regenReport, regeneratedStatus, regeneratingStatus } from './regenerate';

const at = (position: Vector): SupportPoint => ({ id: positionId(position), regionId: 0, position, normal: [0, -1, 0], source: 'interior' });

describe('regenReport', () => {
  const placed = [at([0, 0, 0]), at([10, 0, 0]), at([20, 0, 0])];

  it('keeps the added supports and counts removals and per-support settings by what became of them', () => {
    // One removal names a contact that is placed again, one moved a little (re-matched), one has no neighbour left.
    const deleted = [placed[0]!.id, positionId([10.4, 0, 0]), positionId([50, 0, 0])];
    const overrides = { 'manual-a': { neckLength: 4 }, [positionId([19.6, 0, 0])]: { neckLength: 4 }, [positionId([-40, 0, 0])]: { neckLength: 4 } };
    const handWork = rekeyHandWork(deleted, overrides, new Set(['manual-a']), placed, 1.5);
    expect(regenReport(4, handWork)).toEqual({ added: 4, removed: 2, reset: 1, customisedKept: 2, customisedReset: 1 });
  });

  it('is all zeros for an object with no hand work', () => {
    expect(regenReport(0, rekeyHandWork([], {}, new Set(), placed, 1.5))).toEqual({ added: 0, removed: 0, reset: 0, customisedKept: 0, customisedReset: 0 });
  });
});

describe('regeneration statuses', () => {
  it('names the object or the count, and says a placement change did it', () => {
    expect(regeneratingStatus({ n: 1, name: 'bust' }, 'button')).toMatchObject({ key: 'Regenerating {name}.', vars: { n: 1, name: 'bust' } });
    expect(regeneratingStatus({ n: 3, name: 'bust' }, 'placement').other).toBe('Placement changed: regenerating {n} objects.');
  });

  it('reports hand work only when there was some', () => {
    expect(regeneratedStatus('bust', 40, { added: 0, removed: 0, reset: 0, customisedKept: 0, customisedReset: 0 }).key).toBe('{name}: {n} automatic contacts generated.');
    expect(regeneratedStatus('bust', 40, { added: 2, removed: 3, reset: 1, customisedKept: 0, customisedReset: 0 })).toMatchObject({ vars: { name: 'bust', n: 40, added: 2, removed: 3, reset: 1 } });
  });

  it('reports customised supports even when they are the only hand work', () => {
    const only = { added: 0, removed: 0, reset: 0, customisedKept: 3, customisedReset: 1 };
    expect(hasHandWork(only)).toBe(true);
    expect(regeneratedStatus('bust', 40, only)).toMatchObject({ key: '{name}: {n} automatic contacts generated.', then: { key: '{n} customised kept, {m} reset.', vars: { n: 3, m: 1 } } });
  });

  it('adds the customised sentence to the hand-edit report and to the several-object summary', () => {
    const report = { added: 1, removed: 0, reset: 0, customisedKept: 2, customisedReset: 0 };
    expect(regeneratedStatus('bust', 40, report).then?.vars).toEqual({ n: 2, m: 0 });
    const several = landedStatus([{ name: 'a', placed: 1, report }, { name: 'b', placed: 2, report }]);
    expect(several.then?.vars).toEqual({ n: 4, m: 0 });
  });
});

describe('RegenerateQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('regenerates the units of a burst once, after it goes quiet', () => {
    const run = vi.fn();
    const queue = new RegenerateQueue(run);
    queue.schedule(['a']);
    vi.advanceTimersByTime(REGENERATE_DELAY_MS - 1);
    queue.schedule(['b', 'a']);
    vi.advanceTimersByTime(REGENERATE_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(['a', 'b']);
  });

  it('runs nothing once cancelled, and says it is no longer queued', () => {
    const run = vi.fn();
    const queued: boolean[] = [];
    const queue = new RegenerateQueue(run, (value) => queued.push(value));
    queue.schedule(['a']);
    queue.cancel();
    vi.advanceTimersByTime(REGENERATE_DELAY_MS * 3);
    expect(run).not.toHaveBeenCalled();
    expect(queued).toEqual([true, false]);
    queue.schedule(['b']);
    vi.advanceTimersByTime(REGENERATE_DELAY_MS);
    expect(run).toHaveBeenCalledWith(['b']);
  });
});
