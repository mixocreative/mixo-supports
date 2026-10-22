import { sceneBuffers, unpackProject } from '../state/projectFile';
import type { ProjectResult, ProjectTask } from './projectProtocol';
import { buildPickIndex } from './prepareImport';
import { serveTask, transferable } from './serveTask';

/** Gunzip, JSON parse, revive, normalize and the pick indices of a project file, off the main thread. */
serveTask<ProjectTask, ProjectResult>(async ({ file, triangleLimit }, { progress }) => {
  progress({ fraction: 0.05, stage: 'Reading file' });
  const scene = await unpackProject(file, triangleLimit);
  const share = 0.9 / Math.max(scene.units.length, 1);
  const picks = scene.units.map((unit, k) => {
    progress({ fraction: 0.1 + k * share, stage: 'Building pick index' });
    return buildPickIndex(unit.source);
  });
  progress({ fraction: 1 });
  return transferable({ scene, picks }, [...sceneBuffers(scene), ...picks.flatMap((pick) => [...pick.roots, pick.indirectBuffer.buffer])]);
});
