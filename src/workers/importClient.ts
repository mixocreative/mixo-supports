import type { ImportedMesh, RawMesh } from '../state/import';
import type { ImportRequest, ImportResponse } from './importWorker';

type Progress = (fraction: number, stage: string) => void;

/**
 * Model import in a worker: STL files are parsed there, glTF meshes (parsed on the main thread,
 * where GLTFLoader can decode images) are welded there. The worker only lives while an import
 * runs, so it holds no memory between imports.
 */
export class ImportClient {
  private worker: Worker | null = null;
  private readonly jobs = new Map<number, { resolve: (meshes: ImportedMesh[]) => void; reject: (error: Error) => void; progress: Progress }>();
  private nextJob = 1;

  parseStl(name: string, buffer: ArrayBuffer, progress: Progress): Promise<ImportedMesh[]> {
    return this.send({ kind: 'stl', jobId: this.nextJob++, name, buffer }, [buffer], progress);
  }

  weld(meshes: RawMesh[], progress: Progress): Promise<ImportedMesh[]> {
    return this.send({ kind: 'weld', jobId: this.nextJob++, meshes }, meshes.flatMap((mesh) => [mesh.positions.buffer, ...(mesh.indices ? [mesh.indices.buffer] : [])]), progress);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private send(request: ImportRequest, transfer: Transferable[], progress: Progress): Promise<ImportedMesh[]> {
    return new Promise((resolve, reject) => {
      this.jobs.set(request.jobId, { resolve, reject, progress });
      this.ensureWorker().postMessage(request, transfer);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./importWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<ImportResponse>) => {
      const job = this.jobs.get(data.jobId);
      if (!job) return;
      if (data.kind === 'progress') return job.progress(data.fraction, data.stage);
      this.jobs.delete(data.jobId);
      if (data.kind === 'imported') job.resolve(data.meshes); else job.reject(new Error(data.message));
      if (this.jobs.size === 0) this.dispose();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      for (const job of this.jobs.values()) job.reject(new Error('The import worker stopped.'));
      this.jobs.clear();
      this.dispose();
    };
    this.worker = worker;
    return worker;
  }
}
