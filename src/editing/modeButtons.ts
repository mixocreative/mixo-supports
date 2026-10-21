import type { SessionEvent } from './session';
import type { EditMode } from './types';

/**
 * A left-panel mode button: it enters its mode and, while the mode is on, turns into that mode's
 * exit in the same spot (pressed, ink fill; the viewport's red Done stays the one primary).
 * `label` and `hint` are i18n keys; `event` goes to the session reducer (the host adds the active object).
 */
export interface ModeButton {
  label: string;
  hint: string;
  pressed: boolean;
  disabled: boolean;
  event: SessionEvent;
}

/** Support Edit Mode's button. `canEnter`: an active object that takes hand edits (not heavy). */
export function editModeButton(mode: EditMode, canEnter: boolean): ModeButton {
  if (mode === 'edit') return { label: 'Exit Support Edit Mode', hint: 'Finish editing supports (Esc or Tab)', pressed: true, disabled: false, event: { type: 'toggleEdit' } };
  // Zones mode leaves through its own exit first.
  return { label: 'Enter Support Edit Mode', hint: 'Add or remove supports by clicking (Tab)', pressed: false, disabled: mode === 'zones' || !canEnter, event: { type: 'toggleEdit' } };
}

/** The no-support zones button; from Support Edit Mode, leaving zones comes back there (like Done). */
export function zonesButton(mode: EditMode, canEnter: boolean): ModeButton {
  if (mode === 'zones') return { label: 'Exit no-support zones', hint: 'Finish painting zones (Esc or Enter)', pressed: true, disabled: false, event: { type: 'closeZones' } };
  return { label: 'Paint zones', hint: 'Paint areas of the model where automatic supports must not grow', pressed: false, disabled: !canEnter, event: { type: 'openZones', from: mode === 'edit' ? 'edit' : 'off' } };
}
