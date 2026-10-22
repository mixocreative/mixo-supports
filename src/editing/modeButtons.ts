import { editable, type EditSession, type SessionEvent } from './session';

/**
 * A left-panel mode button: it enters its mode and, while the mode is on, turns into that mode's
 * exit in the same spot (pressed, ink fill; the viewport's red Done stays the one primary).
 * `label` and `hint` are i18n keys; a press sends `event` to the session reducer as it is.
 */
export interface ModeButton {
  label: string;
  hint: string;
  pressed: boolean;
  disabled: boolean;
  event: Extract<SessionEvent, { type: 'enterEdit' | 'enterZones' | 'exit' }>;
}

/** Support Edit Mode's button: entering needs an active object that takes hand edits (not heavy). */
export function editModeButton(session: EditSession): ModeButton {
  const { mode } = session;
  if (mode === 'edit') return { label: 'Exit Support Edit Mode', hint: 'Finish editing supports (Esc)', pressed: true, disabled: false, event: { type: 'exit' } };
  // Zones mode leaves through its own exit first.
  return { label: 'Enter Support Edit Mode', hint: 'Add or remove supports by clicking', pressed: false, disabled: mode === 'zones' || !editable(session), event: { type: 'enterEdit' } };
}

/** The no-support zones button: zones is entered from outside the modes only and always exits to them. */
export function zonesButton(session: EditSession): ModeButton {
  const { mode } = session;
  if (mode === 'zones') return { label: 'Exit no-support zones', hint: 'Finish painting zones (Esc or Enter)', pressed: true, disabled: false, event: { type: 'exit' } };
  return { label: 'Paint zones', hint: 'Paint areas of the model where automatic supports must not grow', pressed: false, disabled: mode === 'edit' || !editable(session), event: { type: 'enterZones' } };
}
