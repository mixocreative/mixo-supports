import type { TriangleMesh } from '../analysis/types';
import type { PrintUnit } from '../state/project';
import type { GeneratedSupportMesh } from '../supports/mesh';
import type { MeshMode, MeshWorkerRequest, MeshWorkerResponse, MeshWorkerUnit } from './meshProtocol';

export interface MeshProgress {
  unitId: string;
  mode: MeshMode;
  fraction: number;
  stage: string;
}

interface Job {
  request: MeshWorkerRequest;
  source: TriangleMesh;
  resolve: (mesh: GeneratedSupportMesh | undefined) => void;
  reject: (error: Error) => void;
}

/**
 * Builds support meshes off the main thread. `build` resolves with the mesh, or with
 * `undefined` when a newer request for the same unit and mode replaced it. Progress for the
 * running job is reported through `onProgress`; `onIdle` fires when nothing is pending.
 */
export class SupportMeshClient {
  private worker: Worker | null = null;
  private readonly jobs = new Map<number, Job>();
  private readonly tokens = new WeakMap<TriangleMesh, number>();
  /** Source token the worker holds for each unit. */
  private readonly sent = new Map<string, number>();
  private nextToken = 1;
  private nextJob = 1;

  constructor(
    private readonly onProgress: (progress: MeshProgress) => void,
    private readonly onIdle: (mode: MeshMode, unitId: string) => void,
  ) {}

  build(unit: PrintUnit, unitIndex: number, mode: MeshMode): Promise<GeneratedSupportMesh | undefined> {
    let token = this.tokens.get(unit.source);
    if (token === undefined) this.tokens.set(unit.source, (token = this.nextToken++));
    const request: MeshWorkerRequest = { jobId: this.nextJob++, unitIndex, mode, sourceToken: token, unit: this.strip(unit, token) };
    return new Promise((resolve, reject) => {
      this.jobs.set(request.jobId, { request, source: unit.source, resolve, reject });
      this.post(request);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  /** Placement regions and contact arrays are not needed; the model goes only once. */
  private strip(unit: PrintUnit, token: number): MeshWorkerUnit {
    const { source, placement, ...rest } = unit;
    const out: MeshWorkerUnit = { ...rest };
    if (placement) out.placement = { points: placement.points, regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
    if (this.sent.get(unit.id) !== token) {
      out.source = source;
      this.sent.set(unit.id, token);
    }
    return out;
  }

  private post(request: MeshWorkerRequest): void {
    this.ensureWorker().postMessage(request);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<MeshWorkerResponse>) => this.receive(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      const error = new Error('Support building failed in the background worker.');
      for (const job of this.jobs.values()) job.reject(error);
      this.jobs.clear();
      this.sent.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private receive(message: MeshWorkerResponse): void {
    const job = this.jobs.get(message.jobId);
    if (!job) return;
    const { unit, mode } = job.request;
    switch (message.kind) {
      case 'progress':
        this.onProgress({ unitId: unit.id, mode, fraction: message.fraction, stage: message.stage });
        return;
      case 'need-source':
        job.request.unit = { ...unit, source: job.source };
        this.sent.set(unit.id, job.request.sourceToken);
        this.post(job.request);
        return;
      case 'result':
        this.finish(message.jobId, () => job.resolve(message.mesh));
        return;
      case 'dropped':
        this.finish(message.jobId, () => job.resolve(undefined));
        return;
      case 'error':
        this.finish(message.jobId, () => job.reject(new Error(message.message)));
        return;
    }
  }

  private finish(jobId: number, settle: () => void): void {
    const job = this.jobs.get(jobId)!;
    this.jobs.delete(jobId);
    settle();
    const { unit, mode } = job.request;
    if (![...this.jobs.values()].some((other) => other.request.unit.id === unit.id && other.request.mode === mode)) this.onIdle(mode, unit.id);
  }
}
