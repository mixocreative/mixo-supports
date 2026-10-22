import { describe, expect, it } from 'vitest';
import type { SupportContact } from '../core/supports/mesh';
import { gesture } from './gesture';
import { FIX_TOOL_EVENTS, initialSession, reduceSession, startsEditing, type EditSession, type SessionEvent } from './session';

const contact = (id: string) => ({ id, position: [0, 0, 0], normal: [0, -1, 0] }) as unknown as SupportContact;
const run = (state: EditSession, ...events: SessionEvent[]) => events.reduce(reduceSession, state);
/** Unit u1 active, nothing else changed. */
const withActive = run(initialSession, { type: 'activeUnitChanged', id: 'u1' });
const editing = run(withActive, { type: 'enterEdit' });
const selected = run(editing, { type: 'setTool', tool: 'select' }, { type: 'toggleContact', id: 'a' }, { type: 'toggleContact', id: 'b' });

describe('reduceSession: modes', () => {
  it('starts outside the modes with the default tools', () => {
    expect(initialSession).toMatchObject({
      mode: 'off', tool: 'add', selectStyle: 'click', brushMode: 'select',
      brushRadius: 24, zoneKind: 'paint', zoneRadius: 2,
    });
    expect(initialSession.selection.size).toBe(0);
  });

  it('Support Edit Mode opens only with an active object, and exit leaves it', () => {
    expect(reduceSession(initialSession, { type: 'enterEdit' })).toBe(initialSession);
    expect(editing.mode).toBe('edit');
    expect(reduceSession(editing, { type: 'exit' }).mode).toBe('off');
  });

  it('a heavy active object takes no hand edits: neither mode opens on it', () => {
    const heavy = run(initialSession, { type: 'activeUnitChanged', id: 'u1', heavy: 1_600_000 });
    expect(heavy).toMatchObject({ activeUnitId: 'u1', heavy: 1_600_000 });
    expect(reduceSession(heavy, { type: 'enterEdit' })).toBe(heavy);
    expect(reduceSession(heavy, { type: 'enterZones' })).toBe(heavy);
    // Another object that is not heavy takes edits again.
    expect(run(heavy, { type: 'activeUnitChanged', id: 'u2' }, { type: 'enterEdit' })).toMatchObject({ mode: 'edit', heavy: undefined });
    // The same object reported again keeps the session.
    expect(reduceSession(heavy, { type: 'activeUnitChanged', id: 'u1', heavy: 1_600_000 })).toBe(heavy);
  });

  it('the modes never switch directly: entering one needs the other exited first', () => {
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(reduceSession(zones, { type: 'enterEdit' })).toBe(zones);
    expect(reduceSession(editing, { type: 'enterZones' })).toBe(editing);
  });

  it('zones mode needs an active object and exit always returns to setup', () => {
    expect(reduceSession(initialSession, { type: 'enterZones' })).toBe(initialSession);
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(zones.mode).toBe('zones');
    expect(reduceSession(zones, { type: 'exit' }).mode).toBe('off');
  });

  it('exit outside the modes changes nothing', () => {
    expect(reduceSession(withActive, { type: 'exit' })).toBe(withActive);
  });

  it('leave ends either mode', () => {
    expect(reduceSession(editing, { type: 'leave' }).mode).toBe('off');
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(reduceSession(zones, { type: 'leave' }).mode).toBe('off');
    expect(reduceSession(initialSession, { type: 'leave' })).toBe(initialSession);
  });

  it('a mode ends when its object goes (delete, undo)', () => {
    expect(reduceSession(editing, { type: 'activeUnitChanged', id: undefined }).mode).toBe('off');
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(reduceSession(zones, { type: 'activeUnitChanged', id: undefined }).mode).toBe('off');
  });

  it('the undo floor is set on entering a mode from outside, not on leaving one', () => {
    expect(startsEditing(withActive, editing)).toBe(true);
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(startsEditing(withActive, zones)).toBe(true);
    expect(startsEditing(zones, reduceSession(zones, { type: 'exit' }))).toBe(false);
    expect(startsEditing(editing, reduceSession(editing, { type: 'exit' }))).toBe(false);
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
    const later = run(changed, { type: 'exit' }, { type: 'activeUnitChanged', id: 'u2' }, { type: 'enterEdit' });
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
    expect(reduceSession(selected, { type: 'exit' }).selection.size).toBe(0);
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

describe('Fix on a check finding', () => {
  it('leaves the Add tool adding, whatever the tool and click action were', () => {
    const removing = run(editing, { type: 'setAddAction', action: 'remove' });
    expect(run(removing, ...FIX_TOOL_EVENTS)).toMatchObject({ tool: 'add', addAction: 'add' });
    expect(run(selected, ...FIX_TOOL_EVENTS)).toMatchObject({ tool: 'add', addAction: 'add' });
  });
});

describe('Drag over: Select | Unselect and Shift', () => {
  const dragging = run(editing, { type: 'setTool', tool: 'select' }, { type: 'setSelectStyle', style: 'brush' }, { type: 'toggleContact', id: 'a' });
  const effective = (state: EditSession) => gesture(state).kind === 'drag' ? (gesture(state) as { brush: { mode: string } }).brush.mode : undefined;

  it('Unselect stays chosen for the session, also across leaving and entering the mode', () => {
    const unselecting = run(dragging, { type: 'setBrushMode', mode: 'unselect' });
    expect(effective(unselecting)).toBe('unselect');
    expect(run(unselecting, { type: 'exit' }, { type: 'enterEdit' }, { type: 'setTool', tool: 'select' }, { type: 'setSelectStyle', style: 'brush' }).brushMode).toBe('unselect');
  });

  it('holding Shift flips the effective action either way and releasing restores it, without touching the switch', () => {
    const held = run(dragging, { type: 'shift', held: true });
    expect(effective(held)).toBe('unselect');
    expect(held.brushMode).toBe('select');
    expect(effective(run(held, { type: 'shift', held: false }))).toBe('select');
    const unselecting = run(dragging, { type: 'setBrushMode', mode: 'unselect' }, { type: 'shift', held: true });
    expect(effective(unselecting)).toBe('select');
    expect(effective(run(unselecting, { type: 'shift', held: false }))).toBe('unselect');
  });

  it('a press on the switch while Shift is down is the choice, and a key repeat is not a flip back', () => {
    const clicked = run(dragging, { type: 'shift', held: true }, { type: 'setBrushMode', mode: 'unselect' });
    expect(effective(clicked)).toBe('unselect');
    expect(run(clicked, { type: 'shift', held: false })).toMatchObject({ brushMode: 'unselect', shiftHeld: false });
  });

  it('leaving the mode lets go of Shift, and Shift outside Support Edit Mode is ignored', () => {
    expect(run(dragging, { type: 'shift', held: true }, { type: 'exit' }).shiftHeld).toBe(false);
    expect(reduceSession(withActive, { type: 'shift', held: true })).toBe(withActive);
  });

  it('a stroke painted while Shift is held takes the supports out of the selection', () => {
    const held = run(dragging, { type: 'shift', held: true });
    expect(run(held, { type: 'paint', ids: ['a', 'x'], mode: effective(held) as 'unselect' }).selection.has('a')).toBe(false);
    expect(run(dragging, { type: 'paint', ids: ['x'], mode: 'select' }).selection.has('x')).toBe(true);
  });
});
