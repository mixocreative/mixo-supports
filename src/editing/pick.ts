import type { EditMode, EditTool, SelectStyle } from './types';

/** Pointer travel (px) above which a click is treated as an orbit drag and ignored. */
export const CLICK_TOLERANCE = 4;

/**
 * One click (left) or context click (right) on an object's model or on its supports, nearest hit
 * first. `contact`: the support triangle hit belongs to a contact's support (braces, raft and
 * labels do not; on the tips view only tips are drawn and picked). `travel` is how far the pointer
 * moved between press and release, in px.
 */
export interface PickInput {
  hit: 'model' | 'support';
  button: 'left' | 'right';
  /** Ctrl or Cmd (meta) held. */
  ctrl: boolean;
  shift: boolean;
  travel: number;
  mode: EditMode;
  tool: EditTool;
  selectStyle: SelectStyle;
  /** The hit object is the active one. */
  active: boolean;
  contact: boolean;
}

/**
 * What a click means. `pass`: this hit does not take it, the object behind gets the click (or
 * none does). `none`: taken, nothing happens. `select`: pick the object (`additive` with Shift).
 * `add` a contact at the model point; `erase` every contact within Erase radius of the point;
 * `removeContact`: erase around the support's contact; `toggle` its selection; `miss`: tell the
 * user what to click instead.
 */
export type PickAction =
  | { type: 'pass' | 'none' | 'add' | 'erase' | 'removeContact' | 'toggle' | 'miss' }
  | { type: 'select'; additive: boolean };

export function pickAction(input: PickInput): PickAction {
  const { hit, button, ctrl, mode, tool, active } = input;
  if (input.travel > CLICK_TOLERANCE) return { type: 'pass' };
  const right = button === 'right';
  // Select supports → Click picks supports; Drag over owns the left button.
  const clickSelecting = tool === 'select' && input.selectStyle === 'click';
  if (hit === 'support') {
    // Supports take clicks only on the object being edited, never while painting zones.
    if (mode !== 'edit' || !active) return { type: 'pass' };
    const toggle = !right && clickSelecting;
    // A plain left click in Add (or any left click in Drag over) passes through to the model behind.
    if (!right && !toggle && (tool === 'select' || !ctrl)) return { type: 'pass' };
    if (!input.contact) return { type: 'pass' };
    return { type: toggle ? 'toggle' : 'removeContact' };
  }
  if (mode === 'off') return right ? { type: 'none' } : { type: 'select', additive: input.shift };
  // Painting zones: the zone brush owns the active model; clicks never select, add or remove.
  if (mode === 'zones') return { type: 'none' };
  if (!active) return { type: 'select', additive: false };
  if (right) return { type: 'erase' };
  // Selecting never adds: Click says to click a support; Drag over owns the left button.
  if (tool === 'select') return { type: clickSelecting ? 'miss' : 'none' };
  return { type: ctrl ? 'erase' : 'add' };
}

/** A click that hit no object: what to click in a mode; outside them a left click clears the object selection. */
export function missAction(input: { mode: EditMode; button: 'left' | 'right' | 'middle'; gizmoDragging: boolean }): { type: 'miss' | 'deselect' | 'none' } {
  if (input.gizmoDragging) return { type: 'none' };
  if (input.mode !== 'off') return { type: 'miss' };
  return { type: input.button === 'left' ? 'deselect' : 'none' };
}
