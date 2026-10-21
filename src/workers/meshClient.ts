import type { TriangleMesh } from '../core/analysis/types';
import type { PrintUnit } from '../state/project';
import type { ExportFilePlan } from '../supports/export';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import type { BuildRequest, ExportedFile, ExportRequest, MeshMode, MeshWorkerResponse, MeshWorkerUnit, UnitPayload } from './meshProtocol';

export interface MeshProgress {
  unitId: string;
  mode: MeshMode;
  fraction: number;
  stage: string;
}

interface BuildJob {
  request: BuildRequest;
  sources: Map<string, TriangleMesh>;
  resolve: (mesh: GeneratedSupportMesh | undefined) => void;
  reject: (error: Error) => void;
}

interface ExportJob {
  request: ExportRequest;
  sources: Map<string, TriangleMesh>;
  onProgress: (fraction: number, stage: string) => void;
  resolve: (files: ExportedFile[]) => void;
  reject: (error: Error) => void;
}

type Job = BuildJob | ExportJob;

/** A running build is only cut short (worker restarted, caches lost) once it has run this long. */
const RESTART_AFTER_MS = 800;

/**
 * One background worker for support meshes. `build` resolves with the mesh, or with `undefined`
 * when a newer request for the same unit and mode replaced it; a replaced build that is already
 * running stops at once when it has run for a while (the worker is restarted and the other
 * jobs are sent again). `exportFiles` builds full-resolution supports and the STL files in the
 * worker. `forget` frees a deleted unit's model and caches in the worker.
 */
export class SupportMeshClient {
  private worker: Worker | null = null;
  private readonly jobs = new Map<number, Job>();
  private readonly tokens = new WeakMap<TriangleMesh, number>();
  /** Source token the worker holds for each unit. */
  private readonly sent = new Map<string, number>();
  private running: { jobId: number; since: number } | undefined;
  private nextToken = 1;
  private nextJob = 1;

  constructor(
    private readonly onProgress: (progress: MeshProgress) => void,
    private readonly onIdle: (mode: MeshMode, unitId: string) => void,
  ) {}

  build(unit: PrintUnit, unitIndex: number, mode: MeshMode): Promise<GeneratedSupportMesh | undefined> {
    const request: BuildRequest = { kind: 'build', jobId: this.nextJob++, mode, ...this.payload(unit, unitIndex) };
    this.cutShort((job) => job.request.kind === 'build' && job.request.unit.id === unit.id && job.request.mode === mode);
    return new Promise((resolve, reject) => {
      this.jobs.set(request.jobId, { request, sources: new Map([[unit.id, unit.source]]), resolve, reject });
      this.post(request);
    });
  }

  exportFiles(units: readonly [PrintUnit, number][], files: ExportFilePlan[], onProgress: (fraction: number, stage: string) => void): Promise<ExportedFile[]> {
    const request: ExportRequest = { kind: 'export', jobId: this.nextJob++, files, units: units.map(([unit, index]) => this.payload(unit, index)) };
    return new Promise((resolve, reject) => {
      this.jobs.set(request.jobId, { request, sources: new Map(units.map(([unit]) => [unit.id, unit.source])), onProgress, resolve, reject });
      this.post(request);
    });
  }

  /** The unit was deleted: free its model and caches in the worker. */
  forget(unitId: string): void {
    if (!this.sent.delete(unitId) || !this.worker) return;
    this.worker.postMessage({ kind: 'forget', unitId });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private payload(unit: PrintUnit, unitIndex: number): UnitPayload {
    let token = this.tokens.get(unit.source);
    if (token === undefined) this.tokens.set(unit.source, (token = this.nextToken++));
    return { unitIndex, sourceToken: token, unit: this.strip(unit, token) };
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

  /** Restart the worker when the running job is one `replaced` matches and has run long enough. */
  private cutShort(replaced: (job: Job) => boolean): void {
    const running = this.running && this.jobs.get(this.running.jobId);
    if (!running || !replaced(running) || performance.now() - this.running!.since < RESTART_AFTER_MS) return;
    this.worker?.terminate();
    this.worker = null;
    this.running = undefined;
    this.sent.clear();
    this.finish(running.request.jobId, () => (running.request.kind === 'build' ? (running as BuildJob).resolve(undefined) : (running as ExportJob).reject(new Error('cancelled'))));
    // Everything else goes to the new worker, with the models it now lacks.
    for (const job of this.jobs.values()) this.post(this.withSources(job));
  }

  private withSources(job: Job): BuildRequest | ExportRequest {
    const add = (payload: UnitPayload): UnitPayload => {
      const source = job.sources.get(payload.unit.id)!;
      this.sent.set(payload.unit.id, payload.sourceToken);
      return { ...payload, unit: { ...payload.unit, source } };
    };
    if (job.request.kind === 'build') return (job.request = { ...job.request, ...add(job.request) });
    return (job.request = { ...job.request, units: job.request.units.map(add) });
  }

  private post(request: BuildRequest | ExportRequest): void {
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
      this.running = undefined;
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private receive(message: MeshWorkerResponse): void {
    const job = this.jobs.get(message.jobId);
    if (!job) return;
    switch (message.kind) {
      case 'started':
        this.running = { jobId: message.jobId, since: performance.now() };
        return;
      case 'progress':
        if (job.request.kind === 'build') this.onProgress({ unitId: job.request.unit.id, mode: job.request.mode, fraction: message.fraction, stage: message.stage });
        else (job as ExportJob).onProgress(message.fraction, message.stage);
        return;
      case 'need-source':
        message.unitIds.forEach((id) => this.sent.delete(id));
        this.post(this.withSources(job));
        return;
      case 'result':
        this.finish(message.jobId, () => (job as BuildJob).resolve(message.mesh));
        return;
      case 'exported':
        this.finish(message.jobId, () => (job as ExportJob).resolve(message.files));
        return;
      case 'dropped':
        this.finish(message.jobId, () => (job as BuildJob).resolve(undefined));
        return;
      case 'error':
        this.finish(message.jobId, () => job.reject(new Error(message.message)));
        return;
    }
  }

  private finish(jobId: number, settle: () => void): void {
    const job = this.jobs.get(jobId)!;
    this.jobs.delete(jobId);
    if (this.running?.jobId === jobId) this.running = undefined;
    settle();
    if (job.request.kind !== 'build') return;
    const { unit, mode } = job.request;
    if (![...this.jobs.values()].some((other) => other.request.kind === 'build' && other.request.unit.id === unit.id && other.request.mode === mode)) this.onIdle(mode, unit.id);
  }
}
