import type { CheckSettings, SupportProblem } from '../analysis/supportCheck';
import type { PlacementResult, PlacementSettings, TriangleMesh } from '../analysis/types';
import type { AnalysisRequest, AnalysisResponse } from './analysisProtocol';

type Vector = [number, number, number];

interface Job {
  key: string;
  request: AnalysisRequest;
  settle: (response: AnalysisResponse | undefined) => void;
}

interface Slot {
  worker: Worker;
  job?: Job;
}

/** Workers for placement and checks: enough to run a few units side by side, never many. */
export function analysisPoolSize(cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2): number {
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

/**
 * Placement and support checks off the main thread, on a small pool of workers (one job per
 * worker at a time, so each worker only holds the model it is working on). Jobs are keyed
 * (`place:<unit>`, `check:<unit>`): a new job replaces a queued one with the same key, and a
 * running one is stopped at once by replacing its worker. Replaced jobs resolve `undefined`.
 */
export class AnalysisClient {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private nextJob = 1;

  constructor(
    private readonly onProgress: (key: string, fraction: number, stage: string) => void,
    private readonly size = analysisPoolSize(),
  ) {}

  place(key: string, mesh: TriangleMesh, settings: PlacementSettings): Promise<PlacementResult | undefined> {
    return this.submit(key, { kind: 'place', jobId: this.nextJob++, mesh, settings }).then((response) => (response?.kind === 'placed' ? response.result : undefined));
  }

  check(key: string, mesh: TriangleMesh, contacts: Vector[], settings: CheckSettings): Promise<SupportProblem[] | undefined> {
    return this.submit(key, { kind: 'check', jobId: this.nextJob++, mesh, contacts, settings }).then((response) => (response?.kind === 'checked' ? response.problems : undefined));
  }

  /** Stop and forget the job with this key, queued or running. */
  cancel(key: string): void {
    const queued = this.queue.findIndex((job) => job.key === key);
    if (queued >= 0) this.queue.splice(queued, 1)[0]!.settle(undefined);
    const slot = this.slots.find((candidate) => candidate.job?.key === key);
    if (slot) this.restart(slot);
  }

  /** Keys of jobs that are queued or running. */
  busy(): string[] {
    return [...this.queue.map((job) => job.key), ...this.slots.flatMap((slot) => (slot.job ? [slot.job.key] : []))];
  }

  dispose(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots.length = 0;
  }

  private submit(key: string, request: AnalysisRequest): Promise<AnalysisResponse | undefined> {
    this.cancel(key);
    return new Promise((resolve, reject) => {
      this.queue.push({
        key,
        request,
        settle: (response) => (response?.kind === 'error' ? reject(new Error(response.message)) : resolve(response)),
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.queue.length > 0) {
      let slot = this.slots.find((candidate) => !candidate.job);
      if (!slot && this.slots.length < this.size) this.slots.push((slot = this.spawn()));
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.job = job;
      const { request } = job;
      // The model moves to the worker; this side keeps no copy.
      slot.worker.postMessage(request, [request.mesh.positions.buffer, request.mesh.indices.buffer]);
    }
  }

  private spawn(): Slot {
    const slot: Slot = { worker: new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' }) };
    slot.worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      const job = slot.job;
      if (!job || job.request.jobId !== event.data.jobId) return;
      if (event.data.kind === 'progress') {
        this.onProgress(job.key, event.data.fraction, event.data.stage);
        return;
      }
      slot.job = undefined;
      job.settle(event.data);
      this.pump();
    };
    slot.worker.onerror = (event) => {
      event.preventDefault();
      const job = slot.job;
      this.restart(slot, false);
      job?.settle({ kind: 'error', jobId: job.request.jobId, message: 'The analysis worker stopped.' });
    };
    return slot;
  }

  /** Replace a slot's worker (stops its job); the job resolves undefined unless `settle` is false. */
  private restart(slot: Slot, settle = true): void {
    const job = slot.job;
    slot.worker.terminate();
    this.slots.splice(this.slots.indexOf(slot), 1);
    if (settle) job?.settle(undefined);
    this.pump();
  }
}
