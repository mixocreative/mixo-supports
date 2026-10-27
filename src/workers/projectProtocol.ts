import type { PrintScene } from '../state/project';

/** Open project in a worker: the file crosses without a copy; the scene comes back with its typed arrays transferred. */
export interface ProjectTask {
  file: Blob;
  /** Triangles above which the file is refused (by size, before it is parsed). */
  triangleLimit: number;
}

/** What the worker sends back: the scene. */
export interface ProjectResult {
  scene: PrintScene;
}
