import type { EditMode } from './types';

/** The part of a key event target the keyboard rules look at (an HTMLElement satisfies it). */
export interface KeyTarget {
  /** Missing on the document itself (no element focused). */
  tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/**
 * Whether Enter on the focused element is that element's own action (press a button, follow a
 * link, open a summary, or a custom control: role="button" or any tabindex), so the editor must
 * not also take it as Done.
 */
export function enterActsOn(target: KeyTarget | null): boolean {
  // The document itself (no element focused) has no attributes.
  if (!target || typeof target.getAttribute !== 'function') return false;
  if (/^(BUTTON|A|SUMMARY)$/i.test(target.tagName)) return true;
  return target.getAttribute('role') === 'button' || target.hasAttribute('tabindex');
}

/** One key press as the editor sees it. `ctrl` is Ctrl or Cmd (meta). */
export interface KeyInput {
  key: string;
  ctrl: boolean;
  shift: boolean;
  /** The focused element (the event target), or null. */
  target: KeyTarget | null;
  mode: EditMode;
  /** Support Edit Mode has selected supports. */
  hasSelection: boolean;
}

/**
 * What a key press does. `leaveMode` is Done in the current mode (Support Edit Mode or zones);
 * `toggleEdit` enters or leaves Support Edit Mode; `preventDefault` stops the browser's own action.
 */
export type KeyAction =
  | { type: 'undo' | 'redo' | 'toggleEdit' | 'leaveMode' | 'deleteSelection' | 'clearSelection' | 'deleteObjects' | 'none'; preventDefault: boolean }
  | { type: 'gizmo'; mode: 'translate' | 'rotate'; preventDefault: boolean };

const NONE: KeyAction = { type: 'none', preventDefault: false };

/** The editor's keyboard rules, first match wins. Keys typed into a form field are left alone. */
export function keyAction({ key, ctrl, shift, target, mode, hasSelection }: KeyInput): KeyAction {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return NONE;
  const lower = key.toLowerCase();
  const done = key === 'Escape' || (key === 'Enter' && !enterActsOn(target));
  if (ctrl && lower === 'z') return { type: shift ? 'redo' : 'undo', preventDefault: true };
  if (ctrl && lower === 'y') return { type: 'redo', preventDefault: true };
  // Zones mode leaves through Done or Esc only.
  if (key === 'Tab') return { type: mode === 'zones' ? 'none' : 'toggleEdit', preventDefault: true };
  if (mode === 'zones' && done) return { type: 'leaveMode', preventDefault: true };
  if (mode === 'edit' && hasSelection && (key === 'Delete' || key === 'Backspace')) return { type: 'deleteSelection', preventDefault: true };
  // Esc first drops the selection, then leaves the mode.
  if (mode === 'edit' && hasSelection && key === 'Escape') return { type: 'clearSelection', preventDefault: true };
  if (mode === 'edit' && done) return { type: 'leaveMode', preventDefault: true };
  if (mode === 'off' && key === 'Delete') return { type: 'deleteObjects', preventDefault: false };
  if (mode === 'off' && lower === 'g') return { type: 'gizmo', mode: 'translate', preventDefault: false };
  if (mode === 'off' && lower === 'r') return { type: 'gizmo', mode: 'rotate', preventDefault: false };
  return NONE;
}
