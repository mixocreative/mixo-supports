import { describe, expect, it } from 'vitest';
import { chooseSupportCandidate } from './candidateSelection';

describe('chooseSupportCandidate', () => {
  const clear = { status: 'clear' as const };
  const blocked = { status: 'blocked' as const, modelFaceIndex: 4 };
  const near = { status: 'inconclusive' as const, reason: 'radius-envelope' };

  it('keeps an initially clear automatic candidate without probing alternatives', () => {
    const visited: number[] = [];
    expect(chooseSupportCandidate(0, [1, 2], {
      origin: 'auto', maxCandidates: 3, permitted: () => true,
      preflight: (value) => { visited.push(value); return clear; },
    })).toEqual({ kind: 'provisional', candidate: 0, screen: 'clear', checked: 1 });
    expect(visited).toEqual([0]);
  });

  it('moves only after a definite block, skipping a forbidden alternate', () => {
    const visited: number[] = [];
    expect(chooseSupportCandidate(0, [1, 2], {
      origin: 'auto', maxCandidates: 3, permitted: (value) => value !== 1,
      preflight: (value) => { visited.push(value); return value === 0 ? blocked : clear; },
    })).toEqual({ kind: 'provisional', candidate: 2, screen: 'clear', checked: 2 });
    expect(visited).toEqual([0, 2]);
  });

  it('never moves or deletes a manual candidate even if its path is blocked', () => {
    const visited: number[] = [];
    expect(chooseSupportCandidate(0, [1, 2], {
      origin: 'manual', maxCandidates: 3, permitted: () => false,
      preflight: (value) => { visited.push(value); return blocked; },
    })).toEqual({ kind: 'manual', candidate: 0, screen: blocked, checked: 1 });
    expect(visited).toEqual([0]);
  });

  it('keeps an ambiguous original provisionally instead of moving it', () => {
    const visited: number[] = [];
    expect(chooseSupportCandidate(0, [1], {
      origin: 'auto', maxCandidates: 2, permitted: () => true,
      preflight: (value) => { visited.push(value); return near; },
    })).toEqual({ kind: 'provisional', candidate: 0, screen: 'inconclusive', checked: 1 });
    expect(visited).toEqual([0]);
  });

  it('does not inspect candidates beyond the declared budget', () => {
    const visited: number[] = [];
    expect(chooseSupportCandidate(0, [1, 2], {
      origin: 'auto', maxCandidates: 2, permitted: () => true,
      preflight: (value) => { visited.push(value); return blocked; },
    })).toEqual({ kind: 'unresolved', reason: 'candidate-budget', checked: 2 });
    expect(visited).toEqual([0, 1]);
  });

  it('stops on a cancelled screen instead of treating it as a provisional placement', () => {
    expect(chooseSupportCandidate(0, [1], {
      origin: 'auto', maxCandidates: 2, permitted: () => true,
      preflight: () => ({ status: 'inconclusive', reason: 'cancelled' }),
    })).toEqual({ kind: 'unresolved', reason: 'cancelled', checked: 1 });
  });
});
