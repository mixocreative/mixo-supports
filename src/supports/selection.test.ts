import { describe, expect, it } from 'vitest';
import type { SupportContact } from './mesh';
import type { PrintUnit } from '../state/project';
import { contactsInBrush, deleteCommands, paintSelection, pruneSelection, toggleSelection } from './selection';

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

  it('keeps identity when none are missing', () => {
    const selected = new Set(['a', 'b']);
    expect(pruneSelection(selected, contacts)).toBe(selected);
  });
});

describe('deleteCommands', () => {
  const unit = { id: 'u1', manual: [{ id: 'manual-a' }] } as unknown as PrintUnit;

  it('removes manual contacts and deletes the rest in one command', () => {
    expect(deleteCommands(unit, ['manual-a', 'auto-x', 'auto-y'])).toEqual([
      { type: 'manual/remove', unitId: 'u1', pointId: 'manual-a' },
      { type: 'deletion/add', unitId: 'u1', pointIds: ['auto-x', 'auto-y'] },
    ]);
  });

  it('returns nothing for no ids', () => {
    expect(deleteCommands(unit, [])).toEqual([]);
  });
});
