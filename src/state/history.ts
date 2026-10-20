import { normalizeScene, reduceScene, sceneJsonReplacer, sceneJsonReviver, type PrintScene, type SceneCommand } from './project';

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
