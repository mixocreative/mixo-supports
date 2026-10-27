import type { TriangleMesh } from '../core/analysis/types';
import type { Runtime } from '../core/budget';
import type { ImportedMesh, RawMesh } from '../state/import';

export type ImportTask =
  /** An STL file, read by the worker slice by slice (a File crosses to the worker without a copy). */
  | { kind: 'stl'; name: string; file: Blob; runtime: Runtime }
  /** glTF meshes already parsed on the main thread (GLTFLoader needs it), to weld. */
  | { kind: 'weld'; meshes: RawMesh[]; runtime: Runtime };

/** A welded, centred mesh with what the viewport needs: when heavy, a display copy. */
export interface PreparedMesh extends ImportedMesh {
  /** Simplified copy to draw (heavy tier only). */
  display?: TriangleMesh;
}
