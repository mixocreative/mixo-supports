import { describe, expect, it } from 'vitest';
import type { PrintUnit } from '../state/project';
import { backNeedsConfirm, discardManualCommands, exitCommands, manualEditCounts } from './flow';

const unit = (over: Partial<PrintUnit> = {}) => ({ id: 'u1', manual: [], deleted: [], contactSettings: {}, ...over }) as unknown as PrintUnit;

describe('dental flow rules', () => {
  it('Back from Step 3 asks only when hand work would be discarded', () => {
    expect(backNeedsConfirm(unit())).toBe(false);
    expect(backNeedsConfirm(undefined)).toBe(false);
    expect(backNeedsConfirm(unit({ manual: [{ id: 'm' }] as never }))).toBe(true);
    expect(backNeedsConfirm(unit({ deleted: ['a'] }))).toBe(true);
    expect(backNeedsConfirm(unit({ contactSettings: { a: {} } }))).toBe(true);
    expect(manualEditCounts(unit({ manual: [{ id: 'm' }] as never, deleted: ['a', 'b'] }))).toEqual({ added: 1, removed: 2, customised: 0 });
  });
  it('a confirmed Back clears the hand work and nothing else', () => {
    expect(discardManualCommands(unit())).toEqual([]);
    expect(discardManualCommands(unit({ deleted: ['a'] }))).toEqual([{ type: 'supports/clear-manual', unitId: 'u1' }]);
  });
  it('Exit returns the aligner being worked on to a normal model: no supports, no dental policy', () => {
    const working = unit({ supports: { kind: 'live', data: {} }, dental: { kind: 'two-contour' } as never, deleted: ['a'] });
    expect(exitCommands(working, [])).toEqual([
      { type: 'supports/remove', unitId: 'u1' },
      { type: 'supports/clear-manual', unitId: 'u1' },
      { type: 'dental/clear', unitId: 'u1' },
    ]);
    // Step 2: a policy but no supports yet.
    expect(exitCommands(unit({ dental: { kind: 'two-contour' } as never }), [])).toEqual([{ type: 'dental/clear', unitId: 'u1' }]);
    // Step 1: nothing to clear.
    expect(exitCommands(unit(), [])).toEqual([]);
  });
  it('Exit keeps a finished aligner exactly as it is', () => {
    const finished = unit({ supports: { kind: 'live', data: {} }, dental: { kind: 'two-contour' } as never });
    expect(exitCommands(finished, ['u1'])).toEqual([]);
    expect(exitCommands(undefined, [])).toEqual([]);
  });
});
