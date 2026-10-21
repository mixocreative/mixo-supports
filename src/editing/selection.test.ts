import { describe, expect, it } from 'vitest';
import type { SupportContact } from '../core/supports/mesh';
import { notSelected, paintSelection, pruneSelection, toggleSelection } from './selection';

const contact = (id: string, position: [number, number, number], normal: [number, number, number] = [0, 1, 0]) =>
  ({ id, position, normal }) as SupportContact;

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
