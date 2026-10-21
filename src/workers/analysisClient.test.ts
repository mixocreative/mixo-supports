import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { PlacementSettings, TriangleMesh } from '../analysis/types';
import { AnalysisClient, analysisPoolSize } from './analysisClient';
import type { AnalysisRequest, AnalysisResponse } from './analysisProtocol';

/** Stand-in for a browser Worker: records what it is sent; the test answers for it. */
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: AnalysisResponse }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  received: AnalysisRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: AnalysisRequest): void {
    this.received.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: AnalysisResponse): void {
    this.onmessage?.({ data });
  }
}

const original = globalThis.Worker;
globalThis.Worker = FakeWorker as unknown as typeof Worker;
afterEach(() => {
  FakeWorker.all = [];
});

const mesh = (): TriangleMesh => ({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) });
const settings = {} as PlacementSettings;
const placed = (jobId: number): AnalysisResponse => ({ kind: 'placed', jobId, result: { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() } });

describe('analysis client', () => {
  it('sizes the pool from the cores, between one and three workers', () => {
    expect(analysisPoolSize(1)).toBe(1);
    expect(analysisPoolSize(4)).toBe(2);
    expect(analysisPoolSize(32)).toBe(3);
  });

  it('runs one job per worker and queues the rest', async () => {
    const client = new AnalysisClient(() => {}, 2);
    const results = ['a', 'b', 'c'].map((unit) => client.place(`place:${unit}`, mesh(), settings));
    expect(FakeWorker.all).toHaveLength(2);
    expect(client.busy().sort()).toEqual(['place:a', 'place:b', 'place:c']);
    FakeWorker.all[0]!.reply(placed(FakeWorker.all[0]!.received[0]!.jobId));
    await expect(results[0]).resolves.toEqual(expect.objectContaining({ points: [] }));
    // The freed worker takes the queued job.
    expect(FakeWorker.all[0]!.received).toHaveLength(2);
  });

  it('replaces a queued job and stops a running one by replacing its worker', async () => {
    const progress: string[] = [];
    const client = new AnalysisClient((key, fraction, stage) => progress.push(`${key} ${stage}`), 1);
    const first = client.place('place:a', mesh(), settings);
    const queued = client.place('place:b', mesh(), settings);
    const newer = client.place('place:b', mesh(), settings);
    await expect(queued).resolves.toBeUndefined();
    const worker = FakeWorker.all[0]!;
    worker.reply({ kind: 'progress', jobId: worker.received[0]!.jobId, fraction: 0.5, stage: 'Scattering contacts' });
    expect(progress).toEqual(['place:a Scattering contacts']);
    const again = client.place('place:a', mesh(), settings);
    await expect(first).resolves.toBeUndefined();
    expect(worker.terminated).toBe(true);
    // A fresh worker runs the next job in line (the newer b), then the newer a.
    const fresh = FakeWorker.all[1]!;
    fresh.reply(placed(fresh.received[0]!.jobId));
    await expect(newer).resolves.toBeDefined();
    fresh.reply(placed(fresh.received[1]!.jobId));
    await expect(again).resolves.toBeDefined();
  });

  it('rejects with the worker error message', async () => {
    const client = new AnalysisClient(() => {}, 1);
    const job = client.check('check:a', mesh(), [], { overhangAngleDegrees: 45, spacing: 2 });
    const worker = FakeWorker.all[0]!;
    worker.reply({ kind: 'error', jobId: worker.received[0]!.jobId, message: 'boom' });
    await expect(job).rejects.toThrow('boom');
  });
});

afterAll(() => {
  globalThis.Worker = original;
});
