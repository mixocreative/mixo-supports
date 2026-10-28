import type { SupportProblem } from '../core/analysis/supportCheck';
import type { DentalRegionProposal } from '../core/analysis/dentalRegion';
import type { DentalTuning } from '../core/analysis/dentalTuning';
import type { DentalOrientation } from '../core/analysis/dentalOrient';
import type { PlacementResult, TriangleMesh } from '../core/analysis/types';
import type { CheckJob, DentalPlacementJob, PlacementJob } from '../core/jobs';
import type { AnalysisResult, AnalysisTask } from './analysisProtocol';
import type { TriangleGate } from '../core/jobGate';
import type { JobLabel } from './jobActivity';
import { REPLACED, WorkerTask, type WorkerLike } from './WorkerTask';

interface Job {
  key: string;
  task: AnalysisTask;
  label: JobLabel;
  /** Aborted (reason REPLACED) when a newer job with the key replaces this one. */
  controller: AbortController;
  settle: (result: AnalysisResult | undefined, error?: unknown) => void;
}

interface Slot {
  runner: WorkerTask<AnalysisTask, AnalysisResult>;
  job?: Job;
}

/** A placement or check on a big model can take minutes; past this the worker is restarted and the job fails. */
const ANALYSIS_TIMEOUT_MS = 10 * 60_000;

/** Workers for placement and checks: enough to run a few units side by side, never many. */
export function analysisPoolSize(cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2): number {
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

/** A copy of the model whose buffers can move to a worker (the scene keeps its own). */
function transferableCopy(mesh: TriangleMesh): TriangleMesh {
  return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
}

/**
 * Placement and support checks off the main thread, on a small pool of WorkerTask runners (one job
 * per worker at a time; each job carries its own copy of the model, so no worker keeps one).
 * Jobs are keyed (`place:<unit>`, `check:<unit>`): a new job replaces a queued one with the same
 * key, and a running one is stopped at once (its worker is replaced). Replaced jobs resolve
 * `undefined`; a job the user cancels (activity Cancel) rejects with AbortError.
 */
export class AnalysisClient {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];

  constructor(
    private readonly create: (() => WorkerLike) | null,
    private readonly onProgress: (key: string, fraction: number, stage: string) => void = () => {},
    private readonly size = analysisPoolSize(),
    /** Heavy-job admission shared with the support mesh clients (placements only; checks are light). */
    private readonly gate?: TriangleGate,
  ) {}

  place(key: string, job: PlacementJob, label: JobLabel): Promise<PlacementResult | undefined> {
    return this.submit(key, { kind: 'place', job }, label).then((result) => (result?.kind === 'placed' ? result.result : undefined));
  }

  dentalPlace(key: string, job: DentalPlacementJob, label: JobLabel): Promise<PlacementResult | undefined> {
    return this.submit(key, { kind: 'dental-place', job }, label).then((result) => (result?.kind === 'dental-placed' ? result.result : undefined));
  }

  /** Step 1 of the dental flow: orientation, opening and mesh check of a dropped aligner, off the main thread. */
  dentalOrient(key: string, mesh: TriangleMesh, profile: string, label: JobLabel): Promise<DentalOrientation | undefined> {
    return this.submit(key, { kind: 'dental-orient', job: { mesh, profile } }, label).then((result) =>
      result?.kind === 'dental-orient-result' ? result.orientation : undefined);
  }

  /** Step 2: the two contours and the strip at the profile's default tuning. */
  dentalRegion(key: string, mesh: TriangleMesh, profile: string, label: JobLabel): Promise<DentalRegionProposal | undefined> {
    return this.submit(key, { kind: 'dental-region', job: { mesh, profile } }, label).then((result) =>
      result?.kind === 'dental-region-result' ? result.region : undefined);
  }

  /**
   * Step 2/3 tuning: the unit's two-contour strip retuned to `tuning` and its contacts placed on it
   * (as `dentalPlace` would for the retuned policy), in one job.
   */
  retunePlaceDental(key: string, job: DentalPlacementJob, tuning: DentalTuning,
    label: JobLabel): Promise<{ region: DentalRegionProposal; placement?: PlacementResult } | undefined> {
    return this.submit(key, { kind: 'dental-retune-place', job: { ...job, tuning } }, label).then((result) =>
      result?.kind === 'dental-retuned' ? { region: result.region, ...(result.placement ? { placement: result.placement } : {}) } : undefined);
  }

  check(key: string, job: CheckJob, label: JobLabel): Promise<SupportProblem[] | undefined> {
    return this.submit(key, { kind: 'check', job }, label).then((result) => (result?.kind === 'checked' ? result.problems : undefined));
  }

  /** Stop and forget the job with this key, queued or running. */
  cancel(key: string): void {
    const queued = this.queue.findIndex((job) => job.key === key);
    if (queued >= 0) this.queue.splice(queued, 1)[0]!.settle(undefined);
    this.slots.find((slot) => slot.job?.key === key)?.job!.controller.abort(REPLACED);
  }

  /** Keys of jobs that are queued or running. */
  busy(): string[] {
    return [...this.queue.map((job) => job.key), ...this.slots.flatMap((slot) => (slot.job ? [slot.job.key] : []))];
  }

  dispose(): void {
    for (const slot of this.slots) slot.runner.terminate();
    this.slots.length = 0;
  }

  private submit(key: string, task: AnalysisTask, label: JobLabel): Promise<AnalysisResult | undefined> {
    this.cancel(key);
    return new Promise((resolve, reject) => {
      this.queue.push({ key, task, label, controller: new AbortController(), settle: (result, error) => (error ? reject(error) : resolve(result)) });
      this.pump();
    });
  }

  private pump(): void {
    while (this.queue.length > 0) {
      let slot = this.slots.find((candidate) => !candidate.job);
      if (!slot && this.slots.length < this.size) {
        slot = { runner: new WorkerTask({ create: this.create, name: 'Support analysis', timeoutMs: ANALYSIS_TIMEOUT_MS }) };
        this.slots.push(slot);
      }
      if (!slot) return;
      const job = this.queue.shift()!;
      this.start(slot, job);
    }
  }

  private start(slot: Slot, job: Job): void {
    slot.job = job;
    // Copied only now, so a queued job that is replaced never costs a copy; the copy moves to the worker.
    const mesh = transferableCopy(job.task.job.mesh);
    const task = { ...job.task, job: { ...job.task.job, mesh } } as AnalysisTask;
    slot.runner.run(task, {
      transfer: [mesh.positions.buffer, mesh.indices.buffer],
      signal: job.controller.signal,
      label: job.label,
      context: job.task.kind,
      ...(this.gate && (job.task.kind === 'place' || job.task.kind === 'dental-place' || job.task.kind === 'dental-region' || job.task.kind === 'dental-retune-place') ? { admit: (signal: AbortSignal) => this.gate!.acquire(mesh.indices.length / 3, signal) } : {}),
      onProgress: (fields) => {
        if (typeof fields.fraction === 'number' && typeof fields.stage === 'string') this.onProgress(job.key, fields.fraction, fields.stage);
      },
    }).then(
      (result) => job.settle(result),
      // Replaced: undefined; cancelled by the user or failed: the error.
      (error: unknown) => (job.controller.signal.aborted ? job.settle(undefined) : job.settle(undefined, error)),
    ).finally(() => {
      slot.job = undefined;
      this.pump();
    });
  }
}
