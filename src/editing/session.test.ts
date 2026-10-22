import { describe, expect, it } from 'vitest';
import type { SupportContact } from '../core/supports/mesh';
import { initialSession, reduceSession, startsEditing, type EditSession, type SessionEvent } from './session';

const contact = (id: string) => ({ id, position: [0, 0, 0], normal: [0, -1, 0] }) as unknown as SupportContact;
const run = (state: EditSession, ...events: SessionEvent[]) => events.reduce(reduceSession, state);
/** Unit u1 active, nothing else changed. */
const withActive = run(initialSession, { type: 'activeUnitChanged', id: 'u1' });
const editing = run(withActive, { type: 'toggleEdit' });
const selected = run(editing, { type: 'setTool', tool: 'select' }, { type: 'toggleContact', id: 'a' }, { type: 'toggleContact', id: 'b' });

describe('reduceSession: modes', () => {
  it('starts outside the modes with the default tools', () => {
    expect(initialSession).toMatchObject({
      mode: 'off', zonesReturn: 'off', tool: 'add', selectStyle: 'click', brushMode: 'select',
      brushRadius: 24, zoneKind: 'paint', zoneRadius: 2,
    });
    expect(initialSession.selection.size).toBe(0);
  });

  it('Tab enters Support Edit Mode only with an active object, and leaves it again', () => {
    expect(reduceSession(initialSession, { type: 'toggleEdit' })).toBe(initialSession);
    expect(editing.mode).toBe('edit');
    expect(reduceSession(editing, { type: 'toggleEdit' }).mode).toBe('off');
  });

  it('a heavy active object takes no hand edits: neither mode opens on it', () => {
    const heavy = run(initialSession, { type: 'activeUnitChanged', id: 'u1', heavy: 1_600_000 });
    expect(heavy).toMatchObject({ activeUnitId: 'u1', heavy: 1_600_000 });
    expect(reduceSession(heavy, { type: 'toggleEdit' })).toBe(heavy);
    expect(reduceSession(heavy, { type: 'openZones', from: 'off' })).toBe(heavy);
    // Another object that is not heavy takes edits again.
    expect(run(heavy, { type: 'activeUnitChanged', id: 'u2' }, { type: 'toggleEdit' })).toMatchObject({ mode: 'edit', heavy: undefined });
    // The same object reported again keeps the session.
    expect(reduceSession(heavy, { type: 'activeUnitChanged', id: 'u1', heavy: 1_600_000 })).toBe(heavy);
  });

  it('zones mode ignores the Edit Mode toggle', () => {
    const zones = reduceSession(withActive, { type: 'openZones', from: 'off' });
    expect(reduceSession(zones, { type: 'toggleEdit' })).toBe(zones);
  });

  it('zones mode needs an active object and goes back where it was opened from', () => {
    expect(reduceSession(initialSession, { type: 'openZones', from: 'off' })).toBe(initialSession);
    const fromOff = reduceSession(withActive, { type: 'openZones', from: 'off' });
    expect(fromOff).toMatchObject({ mode: 'zones', zonesReturn: 'off' });
    expect(reduceSession(fromOff, { type: 'closeZones' }).mode).toBe('off');
    const fromEdit = reduceSession(editing, { type: 'openZones', from: 'edit' });
    expect(fromEdit).toMatchObject({ mode: 'zones', zonesReturn: 'edit' });
    expect(reduceSession(fromEdit, { type: 'closeZones' }).mode).toBe('edit');
  });

  it('closing zones outside zones mode changes nothing', () => {
    expect(reduceSession(editing, { type: 'closeZones' })).toBe(editing);
  });

  it('leave ends either mode', () => {
    expect(reduceSession(editing, { type: 'leave' }).mode).toBe('off');
    const zones = reduceSession(editing, { type: 'openZones', from: 'edit' });
    expect(reduceSession(zones, { type: 'leave' }).mode).toBe('off');
    expect(reduceSession(initialSession, { type: 'leave' })).toBe(initialSession);
  });

  it('a mode ends when its object goes (delete, undo)', () => {
    expect(reduceSession(editing, { type: 'activeUnitChanged', id: undefined }).mode).toBe('off');
    const zones = reduceSession(withActive, { type: 'openZones', from: 'off' });
    expect(reduceSession(zones, { type: 'activeUnitChanged', id: undefined }).mode).toBe('off');
  });

  it('the undo floor is set on entering a mode from outside, not on moving between modes', () => {
    expect(startsEditing(withActive, editing)).toBe(true);
    const zones = reduceSession(withActive, { type: 'openZones', from: 'off' });
    expect(startsEditing(withActive, zones)).toBe(true);
    const zonesFromEdit = reduceSession(editing, { type: 'openZones', from: 'edit' });
    expect(startsEditing(editing, zonesFromEdit)).toBe(false);
    expect(startsEditing(zonesFromEdit, reduceSession(zonesFromEdit, { type: 'closeZones' }))).toBe(false);
    expect(startsEditing(editing, reduceSession(editing, { type: 'toggleEdit' }))).toBe(false);
  });
});

describe('reduceSession: tools', () => {
  it('sets each tool setting and keeps the state when it is unchanged', () => {
    const changed = run(editing,
      { type: 'setTool', tool: 'select' },
      { type: 'setSelectStyle', style: 'brush' },
      { type: 'setBrushMode', mode: 'unselect' },
      { type: 'setBrushRadius', radius: 40 },
      { type: 'setBrushSizing', sizing: true },
      { type: 'setZoneKind', kind: 'erase' },
      { type: 'setZoneRadius', radius: 7 });
    expect(changed).toMatchObject({ tool: 'select', selectStyle: 'brush', brushMode: 'unselect', brushRadius: 40, brushSizing: true, zoneKind: 'erase', zoneRadius: 7 });
    expect(reduceSession(changed, { type: 'setTool', tool: 'select' })).toBe(changed);
  });

  it('tools keep their setting across modes and objects (view state of the session)', () => {
    const changed = run(editing, { type: 'setTool', tool: 'select' }, { type: 'setZoneRadius', radius: 5 });
    const later = run(changed, { type: 'toggleEdit' }, { type: 'activeUnitChanged', id: 'u2' }, { type: 'toggleEdit' });
    expect(later).toMatchObject({ mode: 'edit', tool: 'select', zoneRadius: 5 });
  });

  it('a tool change keeps the selection', () => {
    expect(reduceSession(selected, { type: 'setTool', tool: 'add' }).selection).toBe(selected.selection);
  });
});

describe('reduceSession: selection', () => {
  it('toggles one support in Support Edit Mode only', () => {
    expect([...selected.selection]).toEqual(['a', 'b']);
    expect([...reduceSession(selected, { type: 'toggleContact', id: 'a' }).selection]).toEqual(['b']);
    expect(reduceSession(withActive, { type: 'toggleContact', id: 'a' })).toBe(withActive);
  });

  it('paints and unpaints with Drag over, keeping the state when nothing changes', () => {
    const painted = reduceSession(editing, { type: 'paint', ids: ['a', 'b'], mode: 'select' });
    expect([...painted.selection]).toEqual(['a', 'b']);
    expect(reduceSession(painted, { type: 'paint', ids: ['a'], mode: 'select' })).toBe(painted);
    expect([...reduceSession(painted, { type: 'paint', ids: ['a', 'c'], mode: 'unselect' }).selection]).toEqual(['b']);
    expect(reduceSession(withActive, { type: 'paint', ids: ['a'], mode: 'select' })).toBe(withActive);
  });

  it('clears on request, and an empty selection stays the same state', () => {
    expect(reduceSession(selected, { type: 'clearSelection' }).selection.size).toBe(0);
    expect(reduceSession(editing, { type: 'clearSelection' })).toBe(editing);
  });

  it('puts a cleared selection back exactly (Undo on the toast), in Support Edit Mode only', () => {
    const cleared = reduceSession(selected, { type: 'clearSelection' });
    const restored = reduceSession(cleared, { type: 'restoreSelection', ids: ['a', 'b'] });
    expect([...restored.selection]).toEqual(['a', 'b']);
    expect(reduceSession(withActive, { type: 'restoreSelection', ids: ['a'] })).toBe(withActive);
  });

  it('clears on every mode change', () => {
    expect(reduceSession(selected, { type: 'toggleEdit' }).selection.size).toBe(0);
    expect(reduceSession(selected, { type: 'openZones', from: 'edit' }).selection.size).toBe(0);
    expect(reduceSession(selected, { type: 'leave' }).selection.size).toBe(0);
  });

  it('clears when the active object changes', () => {
    const other = reduceSession(selected, { type: 'activeUnitChanged', id: 'u2' });
    expect(other).toMatchObject({ mode: 'edit', activeUnitId: 'u2' });
    expect(other.selection.size).toBe(0);
    expect(reduceSession(selected, { type: 'activeUnitChanged', id: 'u1' })).toBe(selected);
  });

  it('prunes ids whose contact is gone, keeping identity when all remain', () => {
    const pruned = reduceSession(selected, { type: 'contactsChanged', contacts: [contact('b'), contact('c')] });
    expect([...pruned.selection]).toEqual(['b']);
    expect(reduceSession(selected, { type: 'contactsChanged', contacts: [contact('a'), contact('b')] })).toBe(selected);
  });
});
