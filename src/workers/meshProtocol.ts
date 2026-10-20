import type { TriangleMesh } from '../analysis/types';
import type { PrintUnit } from '../state/project';
import type { GeneratedSupportMesh } from '../supports/mesh';

export type MeshMode = 'preview' | 'export';

/**
 * A unit as the mesh worker needs it. The model travels once per unit (identified by
 * `sourceToken`); later requests omit it and the worker reuses its copy, which also keeps the
 * worker's remesh caches warm.
 */
export interface MeshWorkerUnit extends Omit<PrintUnit, 'source'> {
  source?: TriangleMesh;
}

export interface MeshWorkerRequest {
  jobId: number;
  unitIndex: number;
  mode: MeshMode;
  sourceToken: number;
  unit: MeshWorkerUnit;
}

export type MeshWorkerResponse =
  | { kind: 'progress'; jobId: number; fraction: number; stage: string }
  | { kind: 'result'; jobId: number; mesh: GeneratedSupportMesh }
  /** A newer request for the same unit and mode replaced this one before it started. */
  | { kind: 'dropped'; jobId: number }
  /** The worker has no model for this token (for example after a restart): send it again. */
  | { kind: 'need-source'; jobId: number }
  | { kind: 'error'; jobId: number; message: string };
