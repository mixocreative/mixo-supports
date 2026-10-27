import { sceneBuffers, unpackProject } from '../state/projectFile';
import type { ProjectResult, ProjectTask } from './projectProtocol';
import { serveTask, transferable } from './serveTask';

/** Gunzip, JSON parse, revive and normalize a project file, off the main thread. */
serveTask<ProjectTask, ProjectResult>(async ({ file, triangleLimit }, { progress }) => {
  progress({ fraction: 0.05, stage: 'Reading file' });
  const scene = await unpackProject(file, triangleLimit);
  progress({ fraction: 1 });
  return transferable({ scene }, sceneBuffers(scene));
});
