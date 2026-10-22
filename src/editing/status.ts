import { gesture, type GestureKind } from './gesture';
import type { EditSession, SessionEvent } from './session';
import type { EditMode, StatusMessage } from './types';

// Status lines are i18n keys (data); the host translates them where they are shown.

/** What a click or drag does now, per gesture: the current tool in Support Edit Mode, the brush in zones mode. */
const GESTURE_STATUS: Record<GestureKind, string | undefined> = {
  none: undefined,
  zones: 'Paint where supports must not grow; drag on the model.',
  add: 'Support Edit Mode: click the model to add, right-click a support to remove.',
  pick: 'Support Edit Mode: click supports to select them, right-click a support to remove.',
  drag: 'Support Edit Mode: drag the circle over supports to select them. Supports hidden behind the model are skipped.',
};

/**
 * A Support Edit Mode click that hit neither the model nor a support: what to click instead.
 * Nothing in Drag over: a stroke may start anywhere, and a tap already selected what the circle covered.
 */
const MISS_STATUS: Record<GestureKind, string | undefined> = {
  none: undefined,
  zones: undefined,
  add: 'Nothing under the cursor: click the model to add, right-click a support to remove.',
  pick: 'No support here: click a support to select it.',
  drag: undefined,
};

const keyed = (key: string | undefined): StatusMessage | undefined => (key ? { key } : undefined);

export function editStatus(session: EditSession): StatusMessage | undefined {
  return keyed(GESTURE_STATUS[gesture(session).kind]);
}

/**
 * The status line for one session step (`next` = reduceSession(previous, event)), or undefined to
 * leave it as it is. Entering a mode or switching tool says what a click or drag now does; a
 * forced exit (`leave`, the object gone) is left to the host, which says why.
 */
export function sessionStatus(previous: EditSession, next: EditSession, event: SessionEvent): StatusMessage | undefined {
  if (event.type === 'toggleEdit' && previous.mode === 'off' && !event.activeUnitId) return { key: 'Select an object to edit its supports.' };
  if (event.type === 'openZones' && !event.activeUnitId) return { key: 'Select an object first.' };
  if (event.type === 'toggleEdit' && previous.mode === 'edit' && next.mode === 'off') return { key: 'Support edits kept.' };
  if (event.type === 'closeZones' && previous.mode === 'zones' && next.mode === 'off') return { key: 'No-support zones kept.' };
  if (next.mode === 'off' || next === previous) return undefined;
  const now = editStatus(next);
  return next.mode !== previous.mode || now?.key !== editStatus(previous)?.key ? now : undefined;
}

export function missStatus(session: EditSession): StatusMessage | undefined {
  return keyed(MISS_STATUS[gesture(session).kind]);
}

/** Another object was picked while a mode is on: finish the mode first. */
export function busyStatus(mode: Exclude<EditMode, 'off'>): StatusMessage {
  return { key: mode === 'zones' ? 'Finish painting zones first: press Esc or Done.' : 'Finish editing supports first: press Esc or Done.' };
}
