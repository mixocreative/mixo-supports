import type { EditMode, StatusMessage } from './types';

/** How long an Undo toast stays (the host pauses it while hovered or focused). */
export const UNDO_TOAST_MS = 6000;

/**
 * A destructive action that runs at once (no confirm dialog) and offers Undo for a while:
 * clearing zones or manual edits (one history step), or clearing a selection (view state, so the
 * toast carries the ids to put back).
 */
export type UndoAction =
  /** `hidden`: supports the zones were hiding, which come back. */
  | { kind: 'clearZones'; hidden: number }
  | { kind: 'clearManual' }
  | { kind: 'clearSelection'; ids: readonly string[]; unitId: string }
  /** A regeneration landed on an object (one history step): `message` is its report. */
  | { kind: 'regenerate'; message: StatusMessage };

export interface UndoToast {
  id: number;
  action: UndoAction;
  message: StatusMessage;
  /** History actions: the scene right after the action, set on the first render after it. */
  scene?: unknown;
}

export function undoToast(id: number, action: UndoAction): UndoToast {
  const message: StatusMessage = action.kind === 'regenerate'
    ? action.message
    : action.kind === 'clearZones'
    ? (action.hidden === 0 ? { key: 'No-support zones cleared.' } : { key: 'No-support zones cleared; 1 hidden support comes back.', other: 'No-support zones cleared; {n} hidden supports come back.', vars: { n: action.hidden } })
    : action.kind === 'clearManual'
      ? { key: 'Manual edits cleared; automatic contacts restored.' }
      : { key: 'Selection of 1 support cleared.', other: 'Selection of {n} supports cleared.', vars: { n: action.ids.length } };
  return { id, action, message };
}

/**
 * Whether the toast's Undo still undoes its action: a history clear while the scene is still the
 * one it produced (any later step would make Undo undo something else); a selection clear while
 * the same object is still in Support Edit Mode with nothing selected since (Undo would otherwise
 * replace the newer selection). A toast that is not alive closes.
 */
export function toastAlive(toast: UndoToast, now: { scene: unknown; mode: EditMode; activeUnitId: string | undefined; selectionSize: number }): boolean {
  if (toast.action.kind === 'clearSelection') return now.mode === 'edit' && now.activeUnitId === toast.action.unitId && now.selectionSize === 0;
  return toast.scene === undefined || toast.scene === now.scene;
}
