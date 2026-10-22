import { describe, expect, it } from 'vitest';
import { gesture, gestureMode } from './gesture';
import { initialSession, type EditSession } from './session';

const at = (change: Partial<EditSession>): EditSession => ({ ...initialSession, activeUnitId: 'u1', brushRadius: 32, brushMode: 'unselect', zoneRadius: 3, zoneKind: 'erase', ...change });

describe('gesture: what a press or drag does now, over every mode and tool (table)', () => {
  const table: [EditSession['mode'], EditSession['tool'], EditSession['selectStyle'], ReturnType<typeof gesture>][] = [
    ['off', 'add', 'click', { kind: 'none' }],
    ['off', 'select', 'brush', { kind: 'none' }],
    ['edit', 'add', 'click', { kind: 'add', remove: false }],
    // Add ignores the select style.
    ['edit', 'add', 'brush', { kind: 'add', remove: false }],
    ['edit', 'select', 'click', { kind: 'pick' }],
    ['edit', 'select', 'brush', { kind: 'drag', brush: { radius: 32, mode: 'unselect' }, base: 'unselect', flipped: false, sizing: false }],
    // Zones mode paints whatever the Support Edit Mode tool was.
    ['zones', 'add', 'click', { kind: 'zones', brush: { radius: 3, kind: 'erase' } }],
    ['zones', 'select', 'brush', { kind: 'zones', brush: { radius: 3, kind: 'erase' } }],
  ];
  it.each(table)('%s / %s / %s', (mode, tool, selectStyle, expected) => {
    const now = gesture(at({ mode, tool, selectStyle }));
    expect(now).toEqual(expected);
    expect(gestureMode(now)).toBe(mode);
  });
});

describe('gesture: the Add | Remove switch', () => {
  it('turns the Add tool into the remove click, and only while Add is the tool', () => {
    expect(gesture(at({ mode: 'edit', tool: 'add', addAction: 'remove' }))).toEqual({ kind: 'add', remove: true });
    expect(gesture(at({ mode: 'edit', tool: 'select', addAction: 'remove' })).kind).toBe('pick');
  });
});
