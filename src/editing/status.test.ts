import { describe, expect, it } from 'vitest';
import { initialSession, reduceSession, type EditSession, type SessionEvent } from './session';
import { busyStatus, editStatus, importStatus, missStatus, sessionStatus } from './status';

const ADD = 'Support Edit Mode: click the model to add, right-click a support to remove.';
const CLICK = 'Support Edit Mode: click supports to select them, right-click a support to remove.';
const BRUSH = 'Support Edit Mode: drag the circle over supports to select them. Supports hidden behind the model are skipped.';
const ZONES = 'Paint where supports must not grow; drag on the model.';

const active = reduceSession(initialSession, { type: 'activeUnitChanged', id: 'u1' });
const at = (change: Partial<EditSession>): EditSession => ({ ...active, ...change });
/** The status line one event leads to, from `state`. */
const after = (state: EditSession, event: SessionEvent) => sessionStatus(state, reduceSession(state, event), event);

describe('editStatus', () => {
  it('says what a click or drag does with the current tool', () => {
    expect(editStatus(at({ mode: 'edit', tool: 'add' }))).toEqual({ key: ADD });
    expect(editStatus(at({ mode: 'edit', tool: 'select', selectStyle: 'click' }))).toEqual({ key: CLICK });
    expect(editStatus(at({ mode: 'edit', tool: 'select', selectStyle: 'brush' }))).toEqual({ key: BRUSH });
    // Add ignores the select style.
    expect(editStatus(at({ mode: 'edit', tool: 'add', selectStyle: 'brush' }))).toEqual({ key: ADD });
  });

  it('says what zones mode paints, and nothing outside the modes', () => {
    expect(editStatus(at({ mode: 'zones' }))).toEqual({ key: ZONES });
    expect(editStatus(at({ mode: 'off' }))).toBeUndefined();
  });
});

describe('sessionStatus', () => {
  const editing = at({ mode: 'edit' });

  it('entering Support Edit Mode or switching tool says what the tool does', () => {
    expect(after(active, { type: 'toggleEdit' })).toEqual({ key: ADD });
    expect(after(editing, { type: 'setTool', tool: 'select' })).toEqual({ key: CLICK });
    expect(after(at({ mode: 'edit', tool: 'select' }), { type: 'setSelectStyle', style: 'brush' })).toEqual({ key: BRUSH });
  });

  it('a change that keeps the tool message says nothing', () => {
    expect(after(at({ mode: 'edit', tool: 'select', selectStyle: 'brush' }), { type: 'setBrushMode', mode: 'unselect' })).toBeUndefined();
    expect(after(editing, { type: 'setTool', tool: 'add' })).toBeUndefined();
    expect(after(editing, { type: 'setSelectStyle', style: 'brush' })).toBeUndefined();
    expect(after(editing, { type: 'toggleContact', id: 'a' })).toBeUndefined();
  });

  it('asks for an object when there is none', () => {
    expect(after(initialSession, { type: 'toggleEdit' })).toEqual({ key: 'Select an object to edit its supports.' });
    expect(after(initialSession, { type: 'openZones', from: 'off' })).toEqual({ key: 'Select an object first.' });
  });

  it('leaving a mode says the edits are kept', () => {
    expect(after(editing, { type: 'toggleEdit' })).toEqual({ key: 'Support edits kept.' });
    expect(after(at({ mode: 'zones', zonesReturn: 'off' }), { type: 'closeZones' })).toEqual({ key: 'No-support zones kept.' });
  });

  it('zones mode opens with its hint and Done back in Edit Mode restores the tool message', () => {
    expect(after(active, { type: 'openZones', from: 'off' })).toEqual({ key: ZONES });
    expect(after(editing, { type: 'openZones', from: 'edit' })).toEqual({ key: ZONES });
    expect(after(at({ mode: 'zones', zonesReturn: 'edit', tool: 'select' }), { type: 'closeZones' })).toEqual({ key: CLICK });
  });

  it('a forced exit or a no-op leaves the status line to the host', () => {
    expect(after(editing, { type: 'leave' })).toBeUndefined();
    expect(after(editing, { type: 'activeUnitChanged', id: undefined })).toBeUndefined();
    expect(after(at({ mode: 'zones' }), { type: 'toggleEdit' })).toBeUndefined();
  });
});

describe('missStatus', () => {
  it('says what to click instead, per tool', () => {
    expect(missStatus(at({ mode: 'edit', tool: 'add' }))).toEqual({ key: 'Nothing under the cursor: click the model to add, right-click a support to remove.' });
    expect(missStatus(at({ mode: 'edit', tool: 'select', selectStyle: 'click' }))).toEqual({ key: 'No support here: click a support to select it.' });
  });

  it('says nothing in Drag over: a stroke may start anywhere, and a tap there already selected what the circle covers', () => {
    expect(missStatus(at({ mode: 'edit', tool: 'select', selectStyle: 'brush' }))).toBeUndefined();
  });

  it('says nothing while painting zones', () => {
    expect(missStatus(at({ mode: 'zones' }))).toBeUndefined();
  });
});

describe('editStatus and missStatus over every mode and tool (table)', () => {
  const MISS_ADD = 'Nothing under the cursor: click the model to add, right-click a support to remove.';
  const MISS_CLICK = 'No support here: click a support to select it.';
  const table: [EditSession['mode'], EditSession['tool'], EditSession['selectStyle'], string | undefined, string | undefined][] = [
    // mode, tool, select style, editStatus, missStatus
    ['off', 'add', 'click', undefined, undefined],
    ['off', 'add', 'brush', undefined, undefined],
    ['off', 'select', 'click', undefined, undefined],
    ['off', 'select', 'brush', undefined, undefined],
    ['edit', 'add', 'click', ADD, MISS_ADD],
    ['edit', 'add', 'brush', ADD, MISS_ADD],
    ['edit', 'select', 'click', CLICK, MISS_CLICK],
    ['edit', 'select', 'brush', BRUSH, undefined],
    ['zones', 'add', 'click', ZONES, undefined],
    ['zones', 'add', 'brush', ZONES, undefined],
    ['zones', 'select', 'click', ZONES, undefined],
    ['zones', 'select', 'brush', ZONES, undefined],
  ];
  it.each(table)('%s / %s / %s', (mode, tool, selectStyle, edit, miss) => {
    const session = at({ mode, tool, selectStyle });
    expect(editStatus(session)?.key).toBe(edit);
    expect(missStatus(session)?.key).toBe(miss);
  });
});

describe('busyStatus', () => {
  it('tells the user to finish the mode first', () => {
    expect(busyStatus('zones')).toEqual({ key: 'Finish painting zones first: press Esc or Done.' });
    expect(busyStatus('edit')).toEqual({ key: 'Finish editing supports first: press Esc or Done.' });
  });
});

describe('importStatus', () => {
  const n = (value: number) => value.toLocaleString();
  const budget = n(1_500_000);

  it('a heavy model says hand editing is off, before anything else', () => {
    expect(importStatus({ name: 'big', triangles: 1_600_000 }, 2_000_000, 2, 'web')).toEqual({
      key: '{name} is a heavy model ({n} triangles, over {budget}): the view shows a simplified copy and hand editing is off. Generate and export use the full model.',
      vars: { name: 'big', n: n(1_600_000), budget },
    });
  });

  it('a plate over the budget wins over the large-model note', () => {
    expect(importStatus({ name: 'mid', triangles: 400_000 }, 1_600_000, 1, 'web')).toEqual({
      key: 'The plate now holds {n} triangles, more than the {budget} this app is tuned for; it may slow down.',
      vars: { n: n(1_600_000), budget },
    });
  });

  it('a large model says the view shows tips only', () => {
    expect(importStatus({ name: 'mid', triangles: 400_000 }, 400_000, 1, 'web')).toEqual({
      key: '{name} is a large model ({n} triangles): the view shows contact tips only to stay smooth. Turn off Tips only to see whole supports.',
      vars: { name: 'mid', n: n(400_000), budget },
    });
  });

  it('otherwise counts the objects that came in', () => {
    expect(importStatus({ name: 'knot', triangles: 32_000 }, 32_000, 3, 'web')).toEqual({
      key: 'Imported 1 object. Generate to place supports.', vars: { n: 3 }, other: 'Imported {n} objects. Generate to place supports.',
    });
  });
});
