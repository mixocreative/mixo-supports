import type { PrintScene } from '../state/project';
import type { SerializedBvh } from '../state/meshExtras';

/** Open project in a worker: the file crosses without a copy; the scene comes back with its typed arrays transferred. */
export interface ProjectTask {
  file: Blob;
  /** Triangles above which the file is refused (by size, before it is parsed). */
  triangleLimit: number;
}

/** What the worker sends back: the scene and each object's pick index (the viewport would otherwise build them on the main thread). */
export interface ProjectResult {
  scene: PrintScene;
  /** One per unit, in order. */
  picks: SerializedBvh[];
}
