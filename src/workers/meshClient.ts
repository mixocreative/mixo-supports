import type { TriangleMesh } from '../core/analysis/types';
import type { JobTransform, SupportJob } from '../core/jobs';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import type { ExportFilePlan } from '../supports/export';
import type { ExportedFile, ExportUnitPayload, MeshMode, MeshTask, MeshTaskResult, SupportJobPayload } from './meshProtocol';
import { WorkerTask, WorkerTaskError, type WorkerLike } from './WorkerTask';

export interface MeshProgress {
  unitId: string;
  mode: MeshMode;
  fraction: number;
  stage: string;
}

/** A unit of an export: its support job and its current plate transform. */
export interface ExportUnit {
  unitId: string;
  job: SupportJob;
  transform: JobTransform;
}

interface Pending {
  /** `unitId|mode` for builds (a newer build replaces it), unique otherwise. */
  key: string;
  /** The unit and mode of a build. */
  build?: { unitId: string; mode: MeshMode };
  task: MeshTask;
  sources: Map<string, TriangleMesh>;
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
  timeoutMs: number;
  settle: (result: MeshTaskResult | undefined, error?: unknown) => void;
  started?: number;
  /** Stopped while running (replaced, its unit removed, or the client disposed): it resolves undefined. */
  cut?: boolean;
}

/** A running build is only cut short (worker restarted, caches lost) once it has run this long. */
const RESTART_AFTER_MS = 800;
const BUILD_TIMEOUT_MS = 5 * 60_000;
const EXPORT_TIMEOUT_MS = 15 * 60_000;

export interface SupportMeshClientOptions {
  create: (() => WorkerLike) | null;
  /**
   * 'persistent' (preview): one worker that keeps each unit's model in its source cache so
   * rebuilds stay fast. 'per-job' (export): a worker per job that ends with it, so nothing stays.
   */
  mode?: 'persistent' | 'per-job';
  onProgress: (progress: MeshProgress) => void;
  onIdle: (mode: MeshMode, unitId: string) => void;
}

/**
 * Support meshes in a background worker (WorkerTask), one job at a time. `build` resolves with the
 * mesh, or with `undefined` when a newer build of the same unit and mode replaced it; a replaced
 * build that is already running stops at once when it has run for a while (the worker is
 * restarted). `exportFiles` builds full-resolution supports and the STL files. `forget` frees a
 * deleted unit's model and caches in the worker.
 */
export class SupportMeshClient {
  private readonly runner: WorkerTask<MeshTask, MeshTaskResult>;
  private readonly perJob: boolean;
  private readonly queue: Pending[] = [];
  private running: Pending | undefined;
  /** Stops the running job: aborting a worker's only job replaces the worker (WorkerTask). */
  private runningAbort: AbortController | undefined;
  private readonly tokens = new WeakMap<TriangleMesh, number>();
  /** Source token the persistent worker holds for each unit. */
  private readonly sent = new Map<string, number>();
  private nextToken = 1;
  private nextKey = 1;

  constructor(private readonly options: SupportMeshClientOptions) {
    this.perJob = options.mode === 'per-job';
    this.runner = new WorkerTask({ create: options.create, mode: options.mode ?? 'persistent', name: 'Support building' });
  }

  build(unitId: string, job: SupportJob): Promise<GeneratedSupportMesh | undefined> {
    const key = `${unitId}|${job.mode}`;
    const queued = this.queue.findIndex((pending) => pending.key === key);
    if (queued >= 0) this.queue.splice(queued, 1)[0]!.settle(undefined);
    if (this.running?.key === key && performance.now() - this.running.started! >= RESTART_AFTER_MS) this.cutShort();
    return new Promise<MeshTaskResult | undefined>((resolve, reject) => {
      this.enqueue({
        key,
        build: { unitId, mode: job.mode },
        task: { kind: 'build', unit: this.payload(unitId, job) },
        sources: new Map([[unitId, job.mesh]]),
        onProgress: (fraction, stage) => this.options.onProgress({ unitId, mode: job.mode, fraction, stage }),
        timeoutMs: BUILD_TIMEOUT_MS,
        settle: (result, error) => (error ? reject(error) : resolve(result)),
      });
    }).then((result) => (result?.kind === 'mesh' ? result.mesh : undefined));
  }

  exportFiles(units: readonly ExportUnit[], files: ExportFilePlan[], onProgress: (fraction: number, stage: string) => void, signal?: AbortSignal): Promise<ExportedFile[]> {
    const payloads: ExportUnitPayload[] = units.map(({ unitId, job, transform }) => ({ ...this.payload(unitId, job), transform }));
    return new Promise<MeshTaskResult | undefined>((resolve, reject) => {
      this.enqueue({
        key: `export|${this.nextKey++}`,
        task: { kind: 'export', units: payloads, files },
        sources: new Map(units.map(({ unitId, job }) => [unitId, job.mesh])),
        onProgress,
        ...(signal ? { signal } : {}),
        timeoutMs: EXPORT_TIMEOUT_MS,
        settle: (result, error) => (error ? reject(error) : resolve(result)),
      });
    }).then((result) => (result?.kind === 'files' ? result.files : []));
  }

  /**
   * The unit was deleted: drop its queued builds (they resolve undefined, never run), stop its
   * running build, and free its model and caches in the worker, so the model never goes back in.
   */
  forget(unitId: string): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const pending = this.queue[index]!;
      if (pending.build?.unitId !== unitId) continue;
      this.queue.splice(index, 1);
      this.finish(pending, undefined);
    }
    // A running build of the unit stops at once (its worker is replaced, so it holds no models).
    if (this.running?.build?.unitId === unitId) this.cutShort();
    else if (this.sent.delete(unitId)) {
      // Ahead of every other job; nothing waits for the answer.
      this.queue.unshift({ key: `forget|${this.nextKey++}`, task: { kind: 'forget', unitId }, sources: new Map(), timeoutMs: BUILD_TIMEOUT_MS, settle: () => {} });
    }
    this.pump();
  }

  /** Stop everything: queued jobs resolve undefined (never run), the running one is stopped. */
  dispose(): void {
    for (const pending of this.queue.splice(0)) pending.settle(undefined);
    if (this.running) this.cutShort();
    this.runner.terminate();
  }

  private payload(unitId: string, job: SupportJob): SupportJobPayload {
    let token = this.tokens.get(job.mesh);
    if (token === undefined) this.tokens.set(job.mesh, (token = this.nextToken++));
    const { mesh: _mesh, ...rest } = job;
    return { unitId, sourceToken: token, job: rest };
  }

  private enqueue(pending: Pending): void {
    this.queue.push(pending);
    this.pump();
  }

  /** Stop the running job (its worker is replaced); it resolves undefined. */
  private cutShort(): void {
    this.running!.cut = true;
    this.runningAbort?.abort();
  }

  /** The task with every model the worker lacks (a per-job worker lacks them all). */
  private withSources(pending: Pending): MeshTask {
    const add = <T extends SupportJobPayload>(payload: T): T => {
      if (!this.perJob && this.sent.get(payload.unitId) === payload.sourceToken) return payload;
      if (!this.perJob) this.sent.set(payload.unitId, payload.sourceToken);
      return { ...payload, source: pending.sources.get(payload.unitId)! };
    };
    const { task } = pending;
    if (task.kind === 'build') return { ...task, unit: add(task.unit) };
    if (task.kind === 'export') return { ...task, units: task.units.map(add) };
    return task;
  }

  private pump(): void {
    if (this.running || this.queue.length === 0) return;
    const pending = this.queue.shift()!;
    this.running = pending;
    pending.started ??= performance.now();
    // Our own controller (fed by the caller's signal), so a per-job export can be stopped too.
    const controller = new AbortController();
    this.runningAbort = controller;
    if (pending.signal?.aborted) controller.abort();
    else pending.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    this.runner.run(this.withSources(pending), {
      timeoutMs: pending.timeoutMs,
      signal: controller.signal,
      onProgress: (fields) => {
        if (typeof fields.fraction === 'number' && typeof fields.stage === 'string') pending.onProgress?.(fields.fraction, fields.stage);
      },
    }).then((result) => {
      if (result.kind === 'need-source' && !pending.cut) {
        // Evicted or a fresh worker: send the models again, ahead of everything else.
        result.unitIds.forEach((id) => this.sent.delete(id));
        this.queue.unshift(pending);
        return;
      }
      this.finish(pending, result);
    }, (error: unknown) => {
      // The worker was restarted (timeout, crash, cut short): it holds no models any more.
      if (error instanceof WorkerTaskError || pending.cut) this.sent.clear();
      if (pending.cut) this.finish(pending, undefined);
      else this.finish(pending, undefined, error);
    }).finally(() => {
      this.running = undefined;
      this.runningAbort = undefined;
      this.pump();
    });
  }

  private finish(pending: Pending, result: MeshTaskResult | undefined, error?: unknown): void {
    pending.settle(result, error);
    if (!pending.build) return;
    if (!this.queue.some((other) => other.key === pending.key)) this.options.onIdle(pending.build.mode, pending.build.unitId);
  }
}
