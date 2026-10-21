import type { ImportedMesh, RawMesh } from '../state/import';
import type { ImportTask } from './importWorker';
import { WorkerTask, type WorkerLike } from './WorkerTask';

type Progress = (fraction: number, stage: string) => void;

/** An import that runs longer than this is stopped (worker terminated) and fails with a timeout. */
const IMPORT_TIMEOUT_MS = 5 * 60_000;

/**
 * Model import in a worker: STL files are parsed there, glTF meshes (parsed on the main thread,
 * where GLTFLoader can decode images) are welded there. A worker lives only while its import
 * runs (WorkerTask 'per-job'), so it holds no memory between imports; `signal` cancels.
 */
export class ImportClient {
  private readonly runner: WorkerTask<ImportTask, ImportedMesh[]>;

  constructor(create: (() => WorkerLike) | null) {
    this.runner = new WorkerTask({ create, mode: 'per-job', name: 'Import', timeoutMs: IMPORT_TIMEOUT_MS });
  }

  parseStl(name: string, buffer: ArrayBuffer, progress: Progress, signal?: AbortSignal): Promise<ImportedMesh[]> {
    return this.runner.run({ kind: 'stl', name, buffer }, { transfer: [buffer], onProgress: forward(progress), ...(signal ? { signal } : {}) });
  }

  weld(meshes: RawMesh[], progress: Progress, signal?: AbortSignal): Promise<ImportedMesh[]> {
    const transfer = meshes.flatMap((mesh) => [mesh.positions.buffer, ...(mesh.indices ? [mesh.indices.buffer] : [])]);
    return this.runner.run({ kind: 'weld', meshes }, { transfer, onProgress: forward(progress), ...(signal ? { signal } : {}) });
  }
}

function forward(progress: Progress) {
  return (fields: Record<string, unknown>) => {
    if (typeof fields.fraction === 'number' && typeof fields.stage === 'string') progress(fields.fraction, fields.stage);
  };
}
