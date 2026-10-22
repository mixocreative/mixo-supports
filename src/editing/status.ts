import { meshTier, TRIANGLE_BUDGET, type Runtime } from '../core/budget';
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
  const entering = (event.type === 'toggleEdit' && previous.mode === 'off') || event.type === 'openZones';
  if (entering && previous.activeUnitId === undefined) return { key: event.type === 'toggleEdit' ? 'Select an object to edit its supports.' : 'Select an object first.' };
  if (entering && previous.heavy !== undefined) return heavyStatus(previous);
  if (event.type === 'toggleEdit' && previous.mode === 'edit' && next.mode === 'off') return { key: 'Support edits kept.' };
  if (event.type === 'closeZones' && previous.mode === 'zones' && next.mode === 'off') return { key: 'No-support zones kept.' };
  if (next.mode === 'off' || next === previous) return undefined;
  const now = editStatus(next);
  return next.mode !== previous.mode || now?.key !== editStatus(previous)?.key ? now : undefined;
}

export function missStatus(session: EditSession): StatusMessage | undefined {
  return keyed(MISS_STATUS[gesture(session).kind]);
}

/** Why a heavy active object takes no hand edits, and what still works; undefined when it is not heavy. */
export function heavyStatus(session: EditSession): StatusMessage | undefined {
  if (session.heavy === undefined) return undefined;
  return { key: 'Too detailed to edit by hand ({n} triangles). Generate and export still use the full model.', vars: { n: session.heavy.toLocaleString() } };
}

/** Another object was picked while a mode is on: finish the mode first. */
export function busyStatus(mode: Exclude<EditMode, 'off'>): StatusMessage {
  return { key: mode === 'zones' ? 'Finish painting zones first: press Esc or Done.' : 'Finish editing supports first: press Esc or Done.' };
}

/**
 * The status line after an import added `added` objects: a heavy or large model, or a plate over the
 * triangle budget, says once what the editor does differently; else how many came in.
 */
export function importStatus(heaviest: { name: string; triangles: number }, plateTriangles: number, added: number, runtime: Runtime): StatusMessage {
  const budget = TRIANGLE_BUDGET[runtime];
  const tier = meshTier(heaviest.triangles, runtime);
  const vars = { name: heaviest.name, n: heaviest.triangles.toLocaleString(), budget: budget.toLocaleString() };
  if (tier === 'heavy') return { key: '{name} is a heavy model ({n} triangles, over {budget}): the view shows a simplified copy and hand editing is off. Generate and export use the full model.', vars };
  // The plate warning wins over the large-model note (Tips only still turns on for a large model).
  if (plateTriangles > budget) return { key: 'The plate now holds {n} triangles, more than the {budget} this app is tuned for; it may slow down.', vars: { n: plateTriangles.toLocaleString(), budget: budget.toLocaleString() } };
  if (tier === 'large') return { key: '{name} is a large model ({n} triangles): the view shows contact tips only to stay smooth. Turn off Tips only to see whole supports.', vars };
  return { key: 'Imported 1 object. Generate to place supports.', vars: { n: added }, other: 'Imported {n} objects. Generate to place supports.' };
}
