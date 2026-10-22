import { normalizeScene, reduceScene, sceneJsonReplacer, sceneJsonReviver, type PrintScene, type SceneCommand } from './project';

export interface SceneHistory {
  past: PrintScene[];
  present: PrintScene;
  future: PrintScene[];
  /** The edit whose steps still merge: set by a coalesced command, gone with the next step, undo or redo. */
  open?: string;
}

export function createSceneHistory(scene: PrintScene): SceneHistory {
  return { past: [], present: normalizeScene(scene), future: [] };
}

/** Undo depth retained; older snapshots are dropped. */
export const HISTORY_LIMIT = 100;

/** Structural equality of scene data, short-cutting on shared references (unchanged units and meshes). */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.length === y.length && x.every((byte, index) => byte === y[index]);
  }
  if (a instanceof Map && b instanceof Map) return a.size === b.size && [...a].every(([key, value]) => b.has(key) && sameData(value, b.get(key)));
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((value) => b.has(value));
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((key) => Object.hasOwn(y, key) && sameData(x[key], y[key]));
}

/**
 * Applies a command as one undoable step. The reducer already validates and copies the
 * data each command introduces, so unchanged units (and their meshes) are shared
 * between snapshots rather than copied per step. Commands that follow each other with one
 * `coalesce` key (a number field's edit, from focus to commit) share one step.
 */
export function withSceneCommand(history: SceneHistory, command: SceneCommand, coalesce?: string): SceneHistory {
  const present = reduceScene(history.present, command);
  if (present === history.present) return history;
  // A burst of commands of one edit (typing a value) is one step: it replaces the scene its first command left.
  if (coalesce !== undefined && history.open === coalesce && history.past.length > 0) {
    // An edit that ends where it began (Esc, or typing the original back) leaves no step.
    if (sameData(present, history.past.at(-1))) return { past: history.past.slice(0, -1), present, future: [] };
    return { ...history, present, future: [] };
  }
  if (coalesce !== undefined) return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present, future: [], open: coalesce };
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present, future: [] };
}

/** Esc in an edit: its step goes, back to the scene before the edit's first command. Another edit's step stays. */
export function cancelSceneEdit(history: SceneHistory, edit: string): SceneHistory {
  const before = history.past.at(-1);
  if (history.open !== edit || before === undefined) return history;
  return { past: history.past.slice(0, -1), present: before, future: [] };
}

/**
 * Whether Undo can step back. `floor` is the scene a mode (Support Edit Mode, zones) was entered
 * with: undo inside the mode stops there. It is the snapshot itself, never an index into `past`,
 * so it holds once the cap starts dropping old steps; when the cap has dropped the floor, every
 * step left was made inside the mode.
 */
export function canUndo(history: SceneHistory, floor?: PrintScene): boolean {
  return history.past.length > 0 && history.present !== floor;
}

export function undoScene(history: SceneHistory): SceneHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoScene(history: SceneHistory): SceneHistory {
  const next = history.future[0];
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

export function serializeSceneHistory(history: SceneHistory): string {
  return JSON.stringify({
    past: history.past.map(normalizeScene),
    present: normalizeScene(history.present),
    future: history.future.map(normalizeScene),
  }, sceneJsonReplacer);
}

export function deserializeSceneHistory(serialized: string): SceneHistory {
  const parsed = JSON.parse(serialized, sceneJsonReviver) as SceneHistory;
  if (!Array.isArray(parsed.past) || !Array.isArray(parsed.future) || parsed.present === undefined) {
    throw new TypeError('Expected serialized scene history');
  }
  return {
    past: parsed.past.map(normalizeScene),
    present: normalizeScene(parsed.present),
    future: parsed.future.map(normalizeScene),
  };
}
