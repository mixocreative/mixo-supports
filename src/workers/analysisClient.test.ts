import { describe, expect, it } from 'vitest';
import type { PlacementSettings, TriangleMesh } from '../core/analysis/types';
import type { DentalPlacementJob, PlacementJob } from '../core/jobs';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { TriangleGate } from '../core/jobGate';
import { AnalysisClient, analysisPoolSize } from './analysisClient';
import { JobActivity } from './jobActivity';
import type { AnalysisTask } from './analysisProtocol';
import type { WorkerLike } from './WorkerTask';

/** Stand-in for a browser Worker: records what it is sent; the test answers for it. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  received: { id: number; payload: AnalysisTask }[] = [];
  transfers: Transferable[][] = [];
  terminated = false;
  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.received.push(message as { id: number; payload: AnalysisTask });
    this.transfers.push(transfer);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: unknown): void {
    this.onmessage?.({ data });
  }
  done(index: number, result: unknown): void {
    this.reply({ id: this.received[index]!.id, type: 'done', result });
  }
}

function pool() {
  const workers: FakeWorker[] = [];
  return { workers, create: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } };
}

const mesh = (): TriangleMesh => ({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) });
const job = (model = mesh()): PlacementJob => ({ mesh: model, orientation: { position: [0, 0, 0], rotation: [0, 0, 0] }, settings: {} as PlacementSettings });
const dentalPolicy: DentalPolicy = {
  profileId: 'reference-aligner',
  rim: {
    boundaryKind: 'lower-edge-loop', points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    openingDirection: [0, -1, 0], centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1],
    visibilityMask: new Uint8Array([1]), visibilityResolution: 1, visibilityMin: [-1, -1], visibilityMax: [1, 1],
  },
  stamps: [],
};
const dentalJob = (model = mesh()): DentalPlacementJob => ({ ...job(model), dental: dentalPolicy });
const placed = { kind: 'placed', result: { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() } };
const dentalPlaced = { ...placed, kind: 'dental-placed' as const };
const label = { key: 'Placing contacts on {name}', vars: { name: 'A' } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('analysis client', () => {
  it('sizes the pool from the cores, between one and three workers', () => {
    expect(analysisPoolSize(1)).toBe(1);
    expect(analysisPoolSize(4)).toBe(2);
    expect(analysisPoolSize(32)).toBe(3);
  });

  it('runs one job per worker and queues the rest', async () => {
    const { workers, create } = pool();
    const client = new AnalysisClient(create, () => {}, 2);
    const results = ['a', 'b', 'c'].map((unit) => client.place(`place:${unit}`, job(), label));
    expect(workers).toHaveLength(2);
    expect(client.busy().sort()).toEqual(['place:a', 'place:b', 'place:c']);
    workers[0]!.done(0, placed);
    await expect(results[0]).resolves.toEqual(expect.objectContaining({ points: [] }));
    await tick();
    // The freed worker takes the queued job.
    expect(workers[0]!.received).toHaveLength(2);
  });

  it('sends a copy of the model and transfers the copy, never the scene arrays', () => {
    const { workers, create } = pool();
    const client = new AnalysisClient(create, () => {}, 1);
    const model = mesh();
    void client.place('place:a', job(model), label);
    const sent = workers[0]!.received[0]!.payload.job.mesh;
    expect(sent.positions).not.toBe(model.positions);
    expect(sent.positions).toEqual(model.positions);
    expect(workers[0]!.transfers[0]).toEqual([sent.positions.buffer, sent.indices.buffer]);
  });

  it('runs dental placement through the same worker and triangle gate as ordinary placement', async () => {
    const { workers, create } = pool();
    const gate = new TriangleGate(1);
    const client = new AnalysisClient(create, () => {}, 2, gate);
    const first = client.dentalPlace('dental:a', dentalJob(), label);
    const second = client.place('place:b', job(), label);
    await tick();
    expect(workers[0]!.received[0]!.payload.kind).toBe('dental-place');
    expect(workers).toHaveLength(1);
    workers[0]!.done(0, dentalPlaced);
    await expect(first).resolves.toEqual(expect.objectContaining({ points: [] }));
    await tick();
    workers[1]!.done(0, placed);
    await expect(second).resolves.toEqual(expect.objectContaining({ points: [] }));
  });

  it('detects a dental region off the main thread and transfers a copy of the mesh', async () => {
    const { workers, create } = pool();
    const client = new AnalysisClient(create, () => {}, 1);
    const source = mesh();
    const pending = client.dentalRegion('dental-region:a', source, 'reference-aligner', label);
    expect(workers[0]!.received[0]!.payload.kind).toBe('dental-region');
    expect(workers[0]!.received[0]!.payload.job).toMatchObject({ profile: 'reference-aligner' });
    expect(workers[0]!.received[0]!.payload.job.mesh).not.toBe(source);
    const region = { kind: 'inconclusive' as const, reason: 'not-an-aligner' };
    workers[0]!.done(0, { kind: 'dental-region-result', region });
    await expect(pending).resolves.toEqual(region);
  });

  it('orients a dropped aligner in a worker job on a copy of the model', async () => {
    const { workers, create } = pool();
    const client = new AnalysisClient(create, () => {}, 1);
    const source = mesh();
    const pending = client.dentalOrient('dental-orient:a', source, 'reference-aligner', label);
    expect(workers[0]!.received[0]!.payload.kind).toBe('dental-orient');
    expect(workers[0]!.received[0]!.payload.job.mesh).not.toBe(source);
    const orientation = { kind: 'failed' as const, reason: 'no-cavity', meshOk: true };
    workers[0]!.done(0, { kind: 'dental-orient-result', orientation });
    await expect(pending).resolves.toEqual(orientation);
  });

  it('retunes an accepted dental region in a replaceable worker job', async () => {
    const { workers, create } = pool();
    const client = new AnalysisClient(create, () => {}, 1);
    const source = mesh();
    const region = { kind: 'proposal' } as never;
    const tuning = { positionMm: 0.7, stripWidthMm: 0.4, density: 1.5 };
    const pending = client.retuneDentalRegion('dental-retune:a', source, region, tuning, 'reference-aligner', label);
    const task = workers[0]!.received[0]!.payload;
    expect(task.kind).toBe('dental-retune');
    expect(task.job.mesh).not.toBe(source);
    expect(task.job).toMatchObject({ region, tuning, profile: 'reference-aligner' });
    const answer = { kind: 'inconclusive' as const, reason: 'invalid-contour' };
    workers[0]!.done(0, { kind: 'dental-region-result', region: answer });
    await expect(pending).resolves.toEqual(answer);
  });

  it('replaces a queued job and stops a running one by replacing its worker', async () => {
    const { workers, create } = pool();
    const progress: string[] = [];
    const client = new AnalysisClient(create, (key, _fraction, stage) => progress.push(`${key} ${stage}`), 1);
    const first = client.place('place:a', job(), label);
    const queued = client.place('place:b', job(), label);
    const newer = client.place('place:b', job(), label);
    await expect(queued).resolves.toBeUndefined();
    const worker = workers[0]!;
    worker.reply({ id: worker.received[0]!.id, type: 'progress', fraction: 0.5, stage: 'Scattering contacts' });
    expect(progress).toEqual(['place:a Scattering contacts']);
    const again = client.place('place:a', job(), label);
    await expect(first).resolves.toBeUndefined();
    expect(worker.terminated).toBe(true);
    await tick();
    // A fresh worker runs the next job in line (the newer b), then the newer a.
    const fresh = workers[1]!;
    fresh.done(0, placed);
    await expect(newer).resolves.toBeDefined();
    await tick();
    fresh.done(1, placed);
    await expect(again).resolves.toBeDefined();
  });

  it('a job the user cancels in the activity list rejects with AbortError', async () => {
    const { workers, create } = pool();
    const client = new AnalysisClient(create, () => {}, 1);
    const job = client.place('place:a', { mesh: mesh(), orientation: { position: [0, 0, 0], rotation: [0, 0, 0] }, settings: {} as PlacementSettings }, label);
    const { jobActivity } = await import('./jobActivity');
    const row = jobActivity.view(Date.now() + 1000).filter((candidate) => candidate.label === label && candidate.cancellable).pop();
    expect(row?.cancellable).toBe(true);
    jobActivity.cancel(row!.id);
    await expect(job).rejects.toSatisfy((error) => (error as Error).name === 'AbortError');
    expect(workers[0]!.terminated).toBe(true);
  });

  it('heavy placements wait for the job gate: the second starts only when the first frees its triangles', async () => {
    const { workers, create } = pool();
    const gate = new TriangleGate(1); // each test mesh has 1 triangle: one placement at a time
    const client = new AnalysisClient(create, () => {}, 2, gate);
    const first = client.place('place:a', job(), label);
    const second = client.place('place:b', job(), label);
    await tick();
    // The second waits for admission: its worker is not even started yet.
    expect(workers.map((worker) => worker.received.length)).toEqual([1]);
    workers[0]!.done(0, placed);
    await expect(first).resolves.toBeDefined();
    await tick();
    expect(workers[1]!.received).toHaveLength(1);
    workers[1]!.done(0, placed);
    await expect(second).resolves.toBeDefined();
    expect(gate.running).toBe(0);
  });

  it('rejects with the worker error message', async () => {
    const { workers, create } = pool();
    const client = new AnalysisClient(create, () => {}, 1);
    const check = client.check('check:a', { mesh: mesh(), orientation: { position: [0, 0, 0], rotation: [0, 0, 0] }, contacts: [], settings: { overhangAngleDegrees: 45, spacing: 2 } }, label);
    workers[0]!.reply({ id: workers[0]!.received[0]!.id, type: 'error', message: 'boom' });
    await expect(check).rejects.toThrow('boom');
  });
});
