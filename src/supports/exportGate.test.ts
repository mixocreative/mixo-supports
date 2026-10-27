import { describe, expect, it } from 'vitest';
import { exportRefusal } from './exportGate';

const result = (over: Partial<{ revision: number; verdict: 'clear' | 'blocked' | 'inconclusive'; islands: 'ok' | 'inconclusive' }> = {}) =>
  ({ unitId: 'a', revision: 3, verdict: 'clear' as const, islands: 'ok' as const, ...over });
const same = () => true;

describe('export gate', () => {
  it('lets a newest, finished, judged result through, blocked included', () => {
    expect(exportRefusal({ revision: 3, units: [result()] }, ['a'], same)).toBeUndefined();
    expect(exportRefusal({ revision: 3, units: [result({ verdict: 'blocked' })] }, ['a'], same)).toBeUndefined();
  });
  it('refuses a unit that changed while the export ran', () => {
    expect(exportRefusal({ revision: 3, units: [result()] }, ['a'], () => false)).toEqual({ reason: 'stale', unitId: 'a' });
  });
  it('refuses a result that answers another revision', () => {
    expect(exportRefusal({ revision: 4, units: [result()] }, ['a'], same)).toEqual({ reason: 'stale', unitId: 'a' });
  });
  it('refuses a unit with no result', () => {
    expect(exportRefusal({ revision: 3, units: [] }, ['a'], same)).toEqual({ reason: 'failed', unitId: 'a' });
  });
  it('refuses an inconclusive body-clearance verdict', () => {
    expect(exportRefusal({ revision: 3, units: [result({ verdict: 'inconclusive' })] }, ['a'], same)).toEqual({ reason: 'inconclusive', unitId: 'a' });
  });
  it('refuses a timed-out build: a timeout is inconclusive even when a crossing was found before it', () => {
    // The engine reports a timeout as inconclusive (never blocked), so the gate refuses it.
    expect(exportRefusal({ revision: 3, units: [result({ verdict: 'inconclusive' })] }, ['a'], same)?.reason).toBe('inconclusive');
  });
  it('does not stop on an inconclusive island verdict (the model mesh itself could not be analysed)', () => {
    expect(exportRefusal({ revision: 3, units: [result({ islands: 'inconclusive' })] }, ['a'], same)).toBeUndefined();
  });
});
