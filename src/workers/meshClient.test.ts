import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TriangleMesh } from '../core/analysis/types';
import type { SupportJob } from '../core/jobs';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import { SupportMeshClient } from './meshClient';
import type { MeshTask } from './meshProtocol';
import type { WorkerLike } from './WorkerTask';

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  received: { id: number; payload: MeshTask }[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    this.received.push(message as { id: number; payload: MeshTask });
  }
  terminate(): void {
    this.terminated = true;
  }
  done(index: number, result: unknown): void {
    this.onmessage?.({ data: { id: this.received[index]!.id, type: 'done', result } });
  }
}

function setup(mode: 'persistent' | 'per-job' = 'persistent') {
  const workers: FakeWorker[] = [];
  const idle: string[] = [];
  const client = new SupportMeshClient({
    create: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    mode,
    onProgress: () => {},
    onIdle: (meshMode, unitId) => idle.push(`${unitId} ${meshMode}`),
  });
  return { client, workers, idle };
}

const model: TriangleMesh = { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };
const job = (mesh = model): SupportJob => ({
  mesh,
  frame: { position: [0, 0, 0], rotation: [0, 0, 0] },
  settings: { ...defaultSupportSettings, roofSeededModes: [] } as LiveSupportSettings,
  contacts: { points: [], manual: [], suppressed: [], deleted: [], zones: [] },
  labelText: 'A',
  mode: 'preview',
});
const built = { kind: 'mesh', mesh: { positions: new Float32Array(), indices: new Uint32Array(), components: [] } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const unitOf = (task: MeshTask) => (task.kind === 'build' ? task.unit : undefined);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('support mesh client', () => {
  it('sends a model once per unit and the job without it afterwards', async () => {
    const { client, workers, idle } = setup();
    const first = client.build('a', job());
    const worker = workers[0]!;
    expect(unitOf(worker.received[0]!.payload)?.source).toBe(model);
    expect(unitOf(worker.received[0]!.payload)?.job).not.toHaveProperty('mesh');
    worker.done(0, built);
    await expect(first).resolves.toEqual(built.mesh);
    expect(idle).toEqual(['a preview']);
    await tick();
    void client.build('a', job());
    expect(unitOf(worker.received[1]!.payload)?.source).toBeUndefined();
  });

  it('sends the model again when the worker asks for it', async () => {
    const { client, workers } = setup();
    void client.build('a', job());
    const worker = workers[0]!;
    worker.done(0, built);
    await tick();
    const next = client.build('a', job());
    worker.done(1, { kind: 'need-source', unitIds: ['a'] });
    await tick();
    expect(unitOf(worker.received[2]!.payload)?.source).toBe(model);
    worker.done(2, built);
    await expect(next).resolves.toBeDefined();
  });

  it('a newer build replaces a queued one, which resolves undefined', async () => {
    const { client, workers } = setup();
    void client.build('a', job());
    const queued = client.build('b', job());
    const newer = client.build('b', job());
    await expect(queued).resolves.toBeUndefined();
    workers[0]!.done(0, built);
    await tick();
    expect(workers[0]!.received).toHaveLength(2);
    workers[0]!.done(1, built);
    await expect(newer).resolves.toBeDefined();
  });

  it('cuts a long running build short by restarting the worker, which then gets the model again', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { client, workers } = setup();
    const running = client.build('a', job());
    now.mockReturnValue(1000);
    const newer = client.build('a', job());
    await expect(running).resolves.toBeUndefined();
    expect(workers[0]!.terminated).toBe(true);
    await tick();
    const fresh = workers[1]!;
    expect(unitOf(fresh.received[0]!.payload)?.source).toBe(model);
    fresh.done(0, built);
    await expect(newer).resolves.toBeDefined();
  });

  it('lets a build that just started finish', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { client, workers } = setup();
    const running = client.build('a', job());
    now.mockReturnValue(100);
    void client.build('a', job());
    expect(workers[0]!.terminated).toBe(false);
    workers[0]!.done(0, built);
    await expect(running).resolves.toBeDefined();
  });

  it('forget frees the unit in the worker; a later build sends the model again', async () => {
    const { client, workers } = setup();
    void client.build('a', job());
    const worker = workers[0]!;
    worker.done(0, built);
    await tick();
    client.forget('a');
    expect(worker.received[1]!.payload).toEqual({ kind: 'forget', unitId: 'a' });
    worker.done(1, { kind: 'forgotten' });
    await tick();
    void client.build('a', job());
    expect(unitOf(worker.received[2]!.payload)?.source).toBe(model);
  });

  it('per-job export: every model goes with the job and the worker ends with it', async () => {
    const { client, workers } = setup('per-job');
    const files = client.exportFiles([{ unitId: 'a', job: { ...job(), mode: 'export' }, transform: { position: [1, 2, 3], rotation: [0, 0, 0] } }], [], () => {});
    const worker = workers[0]!;
    const task = worker.received[0]!.payload;
    expect(task.kind === 'export' && task.units[0]!.source).toBe(model);
    expect(task.kind === 'export' && task.units[0]!.transform).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0] });
    worker.done(0, { kind: 'files', files: [{ fileName: 'a.stl', buffer: new ArrayBuffer(84) }] });
    await expect(files).resolves.toHaveLength(1);
    expect(worker.terminated).toBe(true);
  });

  it('cancels an export through its signal', async () => {
    const { client } = setup('per-job');
    const controller = new AbortController();
    const files = client.exportFiles([], [], () => {}, controller.signal);
    controller.abort();
    await expect(files).rejects.toSatisfy((error) => (error as Error).name === 'AbortError');
  });
});
