import { describe, expect, it } from 'vitest';
import { omittedProblems } from './omittedProblem';

const contacts = [
  { id: 'a', position: [1, 0, 0] as [number, number, number] },
  { id: 'b', position: [2, 0, 0] as [number, number, number] },
  { id: 'c', position: [3, 0, 0] as [number, number, number] },
];

describe('omittedProblems', () => {
  it('lists the dropped supports as one informational entry at their positions', () => {
    expect(omittedProblems(contacts, { dropped: ['c', 'a'], droppedByZones: [] }))
      .toEqual([{ kind: 'omitted', position: [1, 0, 0], area: 0, points: [[1, 0, 0], [3, 0, 0]] }]);
  });
  it('leaves out the ones a no-support zone took', () => {
    expect(omittedProblems(contacts, { dropped: ['a', 'b'], droppedByZones: ['a'] }))
      .toEqual([{ kind: 'omitted', position: [2, 0, 0], area: 0, points: [[2, 0, 0]] }]);
    expect(omittedProblems(contacts, { dropped: ['a'], droppedByZones: ['a'] })).toEqual([]);
  });
  it('lists nothing without a current build or when nothing was dropped', () => {
    expect(omittedProblems(contacts, undefined)).toEqual([]);
    expect(omittedProblems(contacts, { dropped: [] })).toEqual([]);
    expect(omittedProblems(contacts, { dropped: ['zz'] })).toEqual([]);
  });
});
