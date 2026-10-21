import type { TriangleMesh } from '../core/analysis/types';
import type { PrintUnit } from '../state/project';
import type { ExportFilePlan } from '../supports/export';
import type { GeneratedSupportMesh } from '../core/supports/mesh';

export type MeshMode = 'preview' | 'export';

/**
 * A unit as the mesh worker needs it. The model travels once per unit (identified by
 * `sourceToken`); later requests omit it and the worker reuses its copy, which also keeps the
 * worker's remesh caches warm.
 */
export interface MeshWorkerUnit extends Omit<PrintUnit, 'source'> {
  source?: TriangleMesh;
}

export interface UnitPayload {
  unitIndex: number;
  sourceToken: number;
  unit: MeshWorkerUnit;
}

/** Support mesh of one unit (preview or full export resolution). */
export interface BuildRequest extends UnitPayload {
  kind: 'build';
  jobId: number;
  mode: MeshMode;
}

/** STL files of an export: full-resolution supports plus models, encoded in the worker. */
export interface ExportRequest {
  kind: 'export';
  jobId: number;
  units: UnitPayload[];
  files: ExportFilePlan[];
}

/** The unit is gone: drop its model, its caches and its queued work. */
export interface ForgetRequest {
  kind: 'forget';
  unitId: string;
}

export type MeshWorkerRequest = BuildRequest | ExportRequest | ForgetRequest;

export interface ExportedFile {
  fileName: string;
  buffer: ArrayBuffer;
}

export type MeshWorkerResponse =
  /** The job left the queue and is running (so it can only be stopped by restarting the worker). */
  | { kind: 'started'; jobId: number }
  | { kind: 'progress'; jobId: number; fraction: number; stage: string }
  | { kind: 'result'; jobId: number; mesh: GeneratedSupportMesh }
  | { kind: 'exported'; jobId: number; files: ExportedFile[] }
  /** A newer request for the same unit and mode replaced this one before it started. */
  | { kind: 'dropped'; jobId: number }
  /** The worker has no model for these units (for example after a restart): send them again. */
  | { kind: 'need-source'; jobId: number; unitIds: string[] }
  | { kind: 'error'; jobId: number; message: string };
