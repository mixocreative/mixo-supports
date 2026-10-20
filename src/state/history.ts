import { normalizeScene, reduceScene, type PrintScene, type SceneCommand } from './project';

export interface SceneHistory {
  past: PrintScene[];
  present: PrintScene;
  future: PrintScene[];
}

export function createSceneHistory(scene: PrintScene): SceneHistory {
  return { past: [], present: normalizeScene(scene), future: [] };
}

export function withSceneCommand(history: SceneHistory, command: SceneCommand): SceneHistory {
  const present = reduceScene(history.present, command);
  if (present === history.present) return history;
  return { past: [...history.past, history.present], present: normalizeScene(present), future: [] };
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
