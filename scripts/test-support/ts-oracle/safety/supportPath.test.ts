import { describe, expect, it } from 'vitest';
import { resolveBirthPaths, type SupportPathLink } from './supportPath';

const births = [{ id: 'lower', height: 5 }, { id: 'upper', height: 9 }];
const link = (from: string, to: 'plate' | string, topY: number, bottomY: number,
  verified = true, origin: 'auto' | 'manual' = 'auto'): SupportPathLink =>
  ({ from, to, topY, bottomY, verified, origin });

describe('resolveBirthPaths', () => {
  it('resolves a higher birth through a verified lower support and plate path', () => {
    expect(resolveBirthPaths(births, [link('lower', 'plate', 5, 0), link('upper', 'lower', 9, 5)])).toEqual({
      status: 'ok', resolved: ['lower', 'upper'], unresolved: [], manualResolved: [],
    });
  });

  it('does not mistake proximity, an unverified crossing, or a too-high tip for a path', () => {
    expect(resolveBirthPaths(births, [link('lower', 'plate', 5, 0, false), link('upper', 'lower', 9, 5)])).toMatchObject({
      status: 'ok', resolved: [], unresolved: ['lower', 'upper'],
    });
    expect(resolveBirthPaths(births, [link('lower', 'plate', 6, 0)])).toMatchObject({
      status: 'ok', resolved: [], unresolved: ['lower', 'upper'],
    });
  });

  it('tracks manual support without removing or treating it as automatic', () => {
    expect(resolveBirthPaths(births, [link('lower', 'plate', 5, 0, true, 'manual'), link('upper', 'lower', 9, 5)])).toEqual({
      status: 'ok', resolved: ['lower', 'upper'], unresolved: [], manualResolved: ['lower', 'upper'],
    });
  });

  it('refuses unknown endpoints and never resolves an unanchored cycle', () => {
    expect(resolveBirthPaths(births, [link('lower', 'upper', 5, 9), link('upper', 'lower', 9, 5)])).toMatchObject({
      status: 'ok', resolved: [], unresolved: ['lower', 'upper'],
    });
    expect(resolveBirthPaths(births, [link('lower', 'missing', 5, 0)])).toMatchObject({ status: 'inconclusive' });
  });

  it('does not count a link that stops above its target or above the plate', () => {
    expect(resolveBirthPaths(births, [link('lower', 'plate', 5, 1), link('upper', 'lower', 9, 4)])).toMatchObject({
      status: 'ok', resolved: [], unresolved: ['lower', 'upper'],
    });
  });

  it('uses an all-automatic route when one exists alongside a manual route', () => {
    expect(resolveBirthPaths(births, [link('lower', 'plate', 5, 0, true, 'manual'),
      link('lower', 'plate', 5, 0), link('upper', 'lower', 9, 5)])).toMatchObject({
      status: 'ok', resolved: ['lower', 'upper'], manualResolved: [],
    });
  });

  it('returns inconclusive on duplicate identities or invalid heights', () => {
    expect(resolveBirthPaths([births[0], births[0]], [])).toMatchObject({ status: 'inconclusive' });
    expect(resolveBirthPaths(births, [link('lower', 'plate', Number.NaN, 0)])).toMatchObject({ status: 'inconclusive' });
  });
});
