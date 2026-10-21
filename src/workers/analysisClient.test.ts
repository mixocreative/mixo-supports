import { describe, expect, it } from 'vitest';
import type { PlacementSettings, TriangleMesh } from '../core/analysis/types';
import type { PlacementJob } from '../core/jobs';
import { AnalysisClient, analysisPoolSize } from './analysisClient';
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
const placed = { kind: 'placed', result: { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() } };
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
    const results = ['a', 'b', 'c'].map((unit) => client.place(`place:${unit}`, job()));
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
    void client.place('place:a', job(model));
    const sent = workers[0]!.received[0]!.payload.job.mesh;
    expect(sent.positions).not.toBe(model.positions);
    expect(sent.positions).toEqual(model.positions);
    expect(workers[0]!.transfers[0]).toEqual([sent.positions.buffer, sent.indices.buffer]);
  });

  it('replaces a queued job and stops a running one by replacing its worker', async () => {
    const { workers, create } = pool();
    const progress: string[] = [];
    const client = new AnalysisClient(create, (key, _fraction, stage) => progress.push(`${key} ${stage}`), 1);
    const first = client.place('place:a', job());
    const queued = client.place('place:b', job());
    const newer = client.place('place:b', job());
    await expect(queued).resolves.toBeUndefined();
    const worker = workers[0]!;
    worker.reply({ id: worker.received[0]!.id, type: 'progress', fraction: 0.5, stage: 'Scattering contacts' });
    expect(progress).toEqual(['place:a Scattering contacts']);
    const again = client.place('place:a', job());
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

  it('rejects with the worker error message', async () => {
    const { workers, create } = pool();
    const client = new AnalysisClient(create, () => {}, 1);
    const check = client.check('check:a', { mesh: mesh(), orientation: { position: [0, 0, 0], rotation: [0, 0, 0] }, contacts: [], settings: { overhangAngleDegrees: 45, spacing: 2 } });
    workers[0]!.reply({ id: workers[0]!.received[0]!.id, type: 'error', message: 'boom' });
    await expect(check).rejects.toThrow('boom');
  });
});
