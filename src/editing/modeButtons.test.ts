import { describe, expect, it } from 'vitest';
import { initialSession, reduceSession, type EditSession } from './session';
import { editModeButton, zonesButton } from './modeButtons';

const withActive = reduceSession(initialSession, { type: 'activeUnitChanged', id: 'u1' });
const editing = reduceSession(withActive, { type: 'toggleEdit', activeUnitId: 'u1' });
const zonesFrom = (state: EditSession, from: 'off' | 'edit') => reduceSession(state, { type: 'openZones', from, activeUnitId: 'u1' });

describe('mode buttons: the entry button becomes the exit button', () => {
  it('outside the modes both buttons enter, unpressed', () => {
    expect(editModeButton('off', true)).toMatchObject({ label: 'Enter Support Edit Mode', pressed: false, disabled: false });
    expect(zonesButton('off', true)).toMatchObject({ label: 'Paint zones', pressed: false, disabled: false, event: { type: 'openZones', from: 'off' } });
  });

  it('both need an editable active object to enter', () => {
    expect(editModeButton('off', false).disabled).toBe(true);
    expect(zonesButton('off', false).disabled).toBe(true);
    expect(zonesButton('edit', false).disabled).toBe(true);
  });

  it('in Support Edit Mode its button reads Exit, pressed, and leaves the mode', () => {
    const button = editModeButton('edit', true);
    expect(button).toMatchObject({ label: 'Exit Support Edit Mode', pressed: true, disabled: false, event: { type: 'toggleEdit' } });
    expect(reduceSession(editing, { type: 'toggleEdit', activeUnitId: 'u1' }).mode).toBe('off');
    // Leaving never needs an editable object.
    expect(editModeButton('edit', false).disabled).toBe(false);
  });

  it('from Support Edit Mode, Paint zones remembers to come back', () => {
    expect(zonesButton('edit', true)).toMatchObject({ label: 'Paint zones', pressed: false, event: { type: 'openZones', from: 'edit' } });
  });

  it('in zones mode Paint zones reads Exit, pressed, and exits exactly like Done', () => {
    const button = zonesButton('zones', false);
    expect(button).toMatchObject({ label: 'Exit no-support zones', pressed: true, disabled: false, event: { type: 'closeZones' } });
    expect(reduceSession(zonesFrom(withActive, 'off'), button.event).mode).toBe('off');
    expect(reduceSession(zonesFrom(editing, 'edit'), button.event).mode).toBe('edit');
    // The Edit Mode button waits: zones mode leaves through its own exit.
    expect(editModeButton('zones', true)).toMatchObject({ label: 'Enter Support Edit Mode', pressed: false, disabled: true });
  });
});

describe('mode buttons over every mode, with and without an editable active object (table)', () => {
  const EXIT_EDIT = { label: 'Exit Support Edit Mode', hint: 'Finish editing supports (Esc or Tab)', pressed: true, disabled: false, event: { type: 'toggleEdit' } };
  const enterEdit = (disabled: boolean) => ({ label: 'Enter Support Edit Mode', hint: 'Add or remove supports by clicking (Tab)', pressed: false, disabled, event: { type: 'toggleEdit' } });
  const EXIT_ZONES = { label: 'Exit no-support zones', hint: 'Finish painting zones (Esc or Enter)', pressed: true, disabled: false, event: { type: 'closeZones' } };
  const paintZones = (disabled: boolean, from: 'off' | 'edit') => ({ label: 'Paint zones', hint: 'Paint areas of the model where automatic supports must not grow', pressed: false, disabled, event: { type: 'openZones', from } });
  const table = [
    ['off', true, enterEdit(false), paintZones(false, 'off')],
    ['off', false, enterEdit(true), paintZones(true, 'off')],
    ['edit', true, EXIT_EDIT, paintZones(false, 'edit')],
    ['edit', false, EXIT_EDIT, paintZones(true, 'edit')],
    ['zones', true, enterEdit(true), EXIT_ZONES],
    ['zones', false, enterEdit(true), EXIT_ZONES],
  ] as const;
  it.each(table)('%s, editable %s', (mode, canEnter, edit, zones) => {
    expect(editModeButton(mode, canEnter)).toEqual(edit);
    expect(zonesButton(mode, canEnter)).toEqual(zones);
  });
});
