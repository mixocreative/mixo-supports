import { describe, expect, it } from 'vitest';
import type { SupportContact } from '../core/supports/mesh';
import { brushSamples, contactsInBrush, notSelected, paintSelection, pruneSelection, toggleSelection } from './selection';

const contact = (id: string, position: [number, number, number], normal: [number, number, number] = [0, 1, 0]) =>
  ({ id, position, normal }) as SupportContact;

describe('contactsInBrush', () => {
  const contacts = [contact('in', [1, 0, 0]), contact('edge', [2, 0, 0]), contact('out', [3, 0, 0])];

  it('returns ids within the radius, boundary included', () => {
    expect(contactsInBrush(contacts, [0, 0, 0], 2)).toEqual(['in', 'edge']);
  });

  it('skips contacts facing away from the camera', () => {
    const wall = [contact('far', [0, 0, 0], [0, 1, 0]), contact('near', [0, 0, 0], [0, -1, 0])];
    expect(contactsInBrush(wall, [0, 0, 0], 1, [0, -1, 0])).toEqual(['near']);
  });
});

describe('brushSamples', () => {
  it('fills a fast move so the brush passes over every support between the two hits', () => {
    const row = [0, 1, 2, 3, 4, 5, 6].map((x) => contact(`c${x}`, [x, 0, 0]));
    const samples = brushSamples([0, 0, 0], [6, 0, 0], 1);
    expect(samples.at(-1)).toEqual([6, 0, 0]);
    const hit = new Set(samples.flatMap((center) => contactsInBrush(row, center, 1)));
    expect([...hit].sort()).toEqual(row.map((item) => item.id));
  });

  it('is just the hit at a stroke start, a short move, or a jump off the model and back', () => {
    expect(brushSamples(undefined, [6, 0, 0], 1)).toEqual([[6, 0, 0]]);
    expect(brushSamples([0, 0, 0], [0.8, 0, 0], 1)).toEqual([[0.8, 0, 0]]);
    expect(brushSamples([0, 0, 0], [20, 0, 0], 1)).toEqual([[20, 0, 0]]);
  });
});

describe('notSelected', () => {
  it('drops the ids already selected, keeping the order', () => {
    expect(notSelected(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c']);
    const ids = ['a'];
    expect(notSelected(ids, new Set())).toBe(ids);
  });
});

describe('paintSelection', () => {
  it('adds on select and removes on unselect', () => {
    expect([...paintSelection(new Set(['a']), ['b'], 'select')]).toEqual(['a', 'b']);
    expect([...paintSelection(new Set(['a', 'b']), ['b'], 'unselect')]).toEqual(['a']);
  });

  it('returns the same set when nothing changes', () => {
    const selected = new Set(['a']);
    expect(paintSelection(selected, ['a'], 'select')).toBe(selected);
    expect(paintSelection(selected, ['z'], 'unselect')).toBe(selected);
  });
});

describe('toggleSelection', () => {
  it('adds then removes', () => {
    const added = toggleSelection(new Set(), 'a');
    expect(added.has('a')).toBe(true);
    expect(toggleSelection(added, 'a').has('a')).toBe(false);
  });
});

describe('pruneSelection', () => {
  const contacts = [contact('a', [0, 0, 0]), contact('b', [0, 0, 0])];

  it('drops ids that no longer exist', () => {
    expect([...pruneSelection(new Set(['a', 'gone']), contacts)]).toEqual(['a']);
  });

  it('empties when the contacts are gone (undo after Delete leaves no stale selection)', () => {
    expect(pruneSelection(new Set(['auto-x']), []).size).toBe(0);
  });

  it('keeps identity when none are missing', () => {
    const selected = new Set(['a', 'b']);
    expect(pruneSelection(selected, contacts)).toBe(selected);
  });
});
