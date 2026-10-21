import type { Runtime } from '../core/budget';
import type { RawMesh } from '../state/import';
import type { JobLabel } from './jobActivity';
import type { ImportTask, PreparedMesh } from './importProtocol';
import { WorkerTask, type WorkerLike } from './WorkerTask';

/** An import that runs longer than this is stopped (worker terminated) and fails with a timeout. */
const IMPORT_TIMEOUT_MS = 5 * 60_000;

/**
 * Model import in a worker: STL files are read and welded there, glTF meshes (parsed on the main
 * thread, where GLTFLoader can decode images) are welded there; both get their pick index (and a
 * display copy when heavy) there. A worker lives only while its import runs (WorkerTask 'per-job'),
 * so it holds no memory between imports. An import blocks editing while it shows and can be cancelled.
 */
export class ImportClient {
  private readonly runner: WorkerTask<ImportTask, PreparedMesh[]>;

  constructor(create: (() => WorkerLike) | null) {
    this.runner = new WorkerTask({ create, mode: 'per-job', name: 'Import', timeoutMs: IMPORT_TIMEOUT_MS });
  }

  readStl(file: Blob, name: string, runtime: Runtime, label: JobLabel, signal: AbortSignal): Promise<PreparedMesh[]> {
    return this.runner.run({ kind: 'stl', name, file, runtime }, { label, signal, blocking: true });
  }

  weld(meshes: RawMesh[], runtime: Runtime, label: JobLabel, signal: AbortSignal): Promise<PreparedMesh[]> {
    const transfer = meshes.flatMap((mesh) => [mesh.positions.buffer, ...(mesh.indices ? [mesh.indices.buffer] : [])]);
    return this.runner.run({ kind: 'weld', meshes, runtime }, { transfer, label, signal, blocking: true });
  }
}
