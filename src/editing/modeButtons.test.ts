import { describe, expect, it } from 'vitest';
import { initialSession, reduceSession, type EditSession } from './session';
import { editModeButton, zonesButton } from './modeButtons';
import { sessionStatus } from './status';

const withActive = reduceSession(initialSession, { type: 'activeUnitChanged', id: 'u1' });
const editing = reduceSession(withActive, { type: 'enterEdit' });
const heavy = reduceSession(initialSession, { type: 'activeUnitChanged', id: 'u1', heavy: 1_600_000 });
const zonesOn = reduceSession(withActive, { type: 'enterZones' });
/** A press: the button's event goes to the session as it is; the status line it leads to. */
const press = (state: EditSession, event: ReturnType<typeof editModeButton>['event']) => {
  const next = reduceSession(state, event);
  return { mode: next.mode, status: sessionStatus(state, next, event)?.key };
};
const HEAVY = 'Too detailed to edit by hand ({n} triangles). Generate and export still use the full model.';

describe('mode buttons: the entry button becomes the exit button', () => {
  it('outside the modes both buttons enter, unpressed', () => {
    expect(editModeButton(withActive)).toMatchObject({ label: 'Enter Support Edit Mode', pressed: false, disabled: false });
    expect(zonesButton(withActive)).toMatchObject({ label: 'Paint zones', pressed: false, disabled: false, event: { type: 'enterZones' } });
  });

  it('both need an editable active object to enter', () => {
    expect(editModeButton(initialSession).disabled).toBe(true);
    expect(zonesButton(initialSession).disabled).toBe(true);
    expect(editModeButton(heavy).disabled).toBe(true);
    expect(zonesButton(heavy).disabled).toBe(true);
  });

  it('in Support Edit Mode its button reads Exit, pressed, and leaves the mode', () => {
    const button = editModeButton(editing);
    expect(button).toMatchObject({ label: 'Exit Support Edit Mode', pressed: true, disabled: false, event: { type: 'exit' } });
    expect(reduceSession(editing, button.event).mode).toBe('off');
  });

  it('zones are not reachable from Support Edit Mode: exit first', () => {
    expect(zonesButton(editing)).toMatchObject({ label: 'Paint zones', pressed: false, disabled: true });
  });

  it('in zones mode Paint zones reads Exit, pressed, and exits exactly like Done', () => {
    const button = zonesButton(zonesOn);
    expect(button).toMatchObject({ label: 'Exit no-support zones', pressed: true, disabled: false, event: { type: 'exit' } });
    expect(reduceSession(zonesOn, button.event).mode).toBe('off');
    // The Edit Mode button waits: zones mode leaves through its own exit.
    expect(editModeButton(zonesOn)).toMatchObject({ label: 'Enter Support Edit Mode', pressed: false, disabled: true });
  });
});

describe('mode buttons over every mode, with and without an editable active object (table)', () => {
  const EXIT_EDIT = { label: 'Exit Support Edit Mode', hint: 'Finish editing supports (Esc)', pressed: true, disabled: false, event: { type: 'exit' } };
  const enterEdit = (disabled: boolean) => ({ label: 'Enter Support Edit Mode', hint: 'Add or remove supports by clicking', pressed: false, disabled, event: { type: 'enterEdit' } });
  const EXIT_ZONES = { label: 'Exit no-support zones', hint: 'Finish painting zones (Esc or Enter)', pressed: true, disabled: false, event: { type: 'exit' } };
  const paintZones = (disabled: boolean) => ({ label: 'Paint zones', hint: 'Paint areas of the model where automatic supports must not grow', pressed: false, disabled, event: { type: 'enterZones' } });
  const session = (mode: EditSession['mode'], object: 'editable' | 'none' | 'heavy'): EditSession => ({
    ...initialSession, mode, activeUnitId: object === 'none' ? undefined : 'u1', heavy: object === 'heavy' ? 1_600_000 : undefined,
  });
  const table = [
    ['off', 'editable', enterEdit(false), paintZones(false)],
    ['off', 'none', enterEdit(true), paintZones(true)],
    ['off', 'heavy', enterEdit(true), paintZones(true)],
    ['edit', 'editable', EXIT_EDIT, paintZones(true)],
    ['zones', 'editable', enterEdit(true), EXIT_ZONES],
  ] as const;
  it.each(table)('%s, object %s', (mode, object, edit, zones) => {
    expect(editModeButton(session(mode, object))).toEqual(edit);
    expect(zonesButton(session(mode, object))).toEqual(zones);
  });
});

describe('a press is the button event, refused by the session when the object takes no hand edits', () => {
  it('enters with an editable object', () => {
    expect(press(withActive, editModeButton(withActive).event)).toEqual({ mode: 'edit', status: 'Support Edit Mode: click the model to add, right-click a support to remove.' });
    expect(press(withActive, zonesButton(withActive).event)).toEqual({ mode: 'zones', status: 'Paint where supports must not grow; drag on the model.' });
  });

  it('asks for an object when there is none', () => {
    expect(press(initialSession, editModeButton(initialSession).event)).toEqual({ mode: 'off', status: 'Select an object to edit its supports.' });
    expect(press(initialSession, zonesButton(initialSession).event)).toEqual({ mode: 'off', status: 'Select an object first.' });
  });

  it('says why a heavy object takes no hand edits (Tab, or a check\'s Fix)', () => {
    expect(press(heavy, { type: 'enterEdit' })).toEqual({ mode: 'off', status: HEAVY });
    expect(press(heavy, { type: 'enterZones' })).toEqual({ mode: 'off', status: HEAVY });
    expect(sessionStatus(heavy, heavy, { type: 'enterEdit' })?.vars).toEqual({ n: (1_600_000).toLocaleString() });
  });
});
