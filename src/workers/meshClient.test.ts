import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TriangleMesh } from '../core/analysis/types';
import type { SupportJob } from '../core/jobs';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import { TriangleGate } from '../core/jobGate';
import { SupportMeshClient } from './meshClient';
import type { MeshTask } from './meshProtocol';
import type { WorkerLike } from './WorkerTask';

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  received: { id: number; payload: MeshTask; revision?: number }[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    this.received.push(message as { id: number; payload: MeshTask; revision?: number });
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answers request `index`, echoing its revision (as `serveTask` does) and, for a mesh, the one `generate` echoes. */
  done(index: number, result: unknown, revision: number | undefined = this.received[index]!.revision): void {
    const answer = result as { kind?: string; mesh?: object };
    const stamped = answer.kind === 'mesh' && answer.mesh && !('revision' in answer.mesh) ? { ...answer, mesh: { ...answer.mesh, revision } } : result;
    this.onmessage?.({ data: { id: this.received[index]!.id, type: 'done', result: stamped, ...(revision != null ? { revision } : {}) } });
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
  contacts: { points: [], manual: [], deleted: [], zones: [], contactSettings: {} },
  labelText: 'A',
  mode: 'preview',
});
const built = { kind: 'mesh', mesh: { positions: new Float32Array(), indices: new Uint32Array(), components: [] } };
const label = { key: 'Building supports for {name}', vars: { name: 'A' } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const unitOf = (task: MeshTask) => (task.kind === 'build' ? task.unit : undefined);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('support mesh client', () => {
  it('sends a model once per unit and the job without it afterwards', async () => {
    const { client, workers, idle } = setup();
    const first = client.build('a', job(), label);
    const worker = workers[0]!;
    expect(unitOf(worker.received[0]!.payload)?.source).toBe(model);
    expect(unitOf(worker.received[0]!.payload)?.job).not.toHaveProperty('mesh');
    worker.done(0, built);
    await expect(first).resolves.toEqual({ ...built.mesh, revision: 1 });
    expect(idle).toEqual(['a preview']);
    await tick();
    void client.build('a', job(), label);
    expect(unitOf(worker.received[1]!.payload)?.source).toBeUndefined();
  });

  it('sends the model again when the worker asks for it', async () => {
    const { client, workers } = setup();
    void client.build('a', job(), label);
    const worker = workers[0]!;
    worker.done(0, built);
    await tick();
    const next = client.build('a', job(), label);
    worker.done(1, { kind: 'need-source', unitIds: ['a'] });
    await tick();
    expect(unitOf(worker.received[2]!.payload)?.source).toBe(model);
    worker.done(2, built);
    await expect(next).resolves.toBeDefined();
  });

  it('a newer build replaces a queued one, which resolves undefined', async () => {
    const { client, workers } = setup();
    void client.build('a', job(), label);
    const queued = client.build('b', job(), label);
    const newer = client.build('b', job(), label);
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
    const running = client.build('a', job(), label);
    now.mockReturnValue(1000);
    const newer = client.build('a', job(), label);
    await expect(running).resolves.toBeUndefined();
    expect(workers[0]!.terminated).toBe(true);
    await tick();
    const fresh = workers[1]!;
    expect(unitOf(fresh.received[0]!.payload)?.source).toBe(model);
    fresh.done(0, built);
    await expect(newer).resolves.toBeDefined();
  });

  it('lets a build that just started finish, but never delivers it once a newer one was requested', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { client, workers } = setup();
    const running = client.build('a', job(), label);
    now.mockReturnValue(100);
    const newer = client.build('a', job(), label);
    expect(workers[0]!.terminated).toBe(false);
    workers[0]!.done(0, built);
    await expect(running).resolves.toBeUndefined();
    await tick();
    workers[0]!.done(1, built);
    await expect(newer).resolves.toMatchObject({ revision: 2 });
  });

  it('drops a reply that echoes another revision or answers with a mesh of another revision', async () => {
    const { client, workers } = setup();
    const echoed = client.build('a', job(), label);
    workers[0]!.done(0, built, 99);
    await expect(echoed).resolves.toBeUndefined();
    await tick();
    const wrong = client.build('a', job(), label);
    workers[0]!.done(1, { kind: 'mesh', mesh: { ...built.mesh, revision: 1 } });
    await expect(wrong).resolves.toBeUndefined();
  });

  it('cancel stops the running build by replacing its worker, drops queued ones, and delivers nothing', async () => {
    const { client, workers, idle } = setup();
    const running = client.build('a', job(), label);
    const queued = client.build('b', job(), label);
    client.cancel('a');
    await expect(running).resolves.toBeUndefined();
    expect(workers[0]!.terminated).toBe(true);
    // A late answer of the terminated worker is ignored; the next request gets a fresh worker and the model again.
    workers[0]!.done(0, built);
    await tick();
    expect(workers).toHaveLength(2);
    expect(unitOf(workers[1]!.received[0]!.payload)?.unitId).toBe('b');
    workers[1]!.done(0, built);
    await expect(queued).resolves.toMatchObject({ revision: 2 });
    expect(idle).toContain('a preview');
  });

  it('forget frees the unit in the worker; a later build sends the model again', async () => {
    const { client, workers } = setup();
    void client.build('a', job(), label);
    const worker = workers[0]!;
    worker.done(0, built);
    await tick();
    client.forget('a');
    expect(worker.received[1]!.payload).toEqual({ kind: 'forget', unitId: 'a' });
    worker.done(1, { kind: 'forgotten' });
    await tick();
    void client.build('a', job(), label);
    expect(unitOf(worker.received[2]!.payload)?.source).toBe(model);
  });

  it('forget drops a queued build of the removed unit: it never runs and its model never reaches the worker', async () => {
    const { client, workers, idle } = setup();
    const running = client.build('b', job({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }), label);
    const queued = client.build('a', job(), label);
    client.forget('a');
    await expect(queued).resolves.toBeUndefined();
    expect(idle).toContain('a preview');
    workers[0]!.done(0, built);
    await expect(running).resolves.toBeDefined();
    await tick();
    expect(workers[0]!.received.map(({ payload }) => unitOf(payload)?.unitId ?? payload.kind)).toEqual(['b']);
  });

  it('forget stops a running build of the removed unit (worker replaced, so no model stays)', async () => {
    const { client, workers } = setup();
    const running = client.build('a', job(), label);
    client.forget('a');
    await expect(running).resolves.toBeUndefined();
    expect(workers[0]!.terminated).toBe(true);
    await tick();
    void client.build('b', job(), label);
    expect(workers[1]!.received.map(({ payload }) => payload.kind)).toEqual(['build']);
  });

  it('a worker crash rejects the build and the next build sends the model again', async () => {
    const { client, workers } = setup();
    const first = client.build('a', job(), label);
    workers[0]!.onerror?.({ message: 'out of memory' });
    await expect(first).rejects.toThrow('out of memory');
    await tick();
    void client.build('a', job(), label);
    expect(unitOf(workers[1]!.received[0]!.payload)?.source).toBe(model);
  });

  it('dispose settles queued jobs and stops the running one', async () => {
    const { client, workers } = setup();
    const running = client.build('a', job(), label);
    const queued = client.build('b', job(), label);
    client.dispose();
    await expect(queued).resolves.toBeUndefined();
    await expect(running).resolves.toBeUndefined();
    expect(workers[0]!.terminated).toBe(true);
  });

  it('a build waits ("Queued") while heavy jobs elsewhere fill the gate, then runs', async () => {
    const gate = new TriangleGate(1);
    const held = await gate.acquire(1); // a placement holding the plate's budget
    const workers: FakeWorker[] = [];
    const client = new SupportMeshClient({ create: () => { const worker = new FakeWorker(); workers.push(worker); return worker; }, gate });
    const build = client.build('a', job(), label);
    await tick();
    expect(workers[0]?.received ?? []).toHaveLength(0);
    held();
    await tick();
    expect(workers[0]!.received).toHaveLength(1);
    workers[0]!.done(0, built);
    await expect(build).resolves.toBeDefined();
    expect(gate.running).toBe(0);
  });

  it('per-job export: every model goes with the job and the worker ends with it', async () => {
    const { client, workers } = setup('per-job');
    const files = client.exportFiles([{ unitId: 'a', job: { ...job(), mode: 'export' }, transform: { position: [1, 2, 3], rotation: [0, 0, 0] } }], [], label, () => {});
    const worker = workers[0]!;
    const task = worker.received[0]!.payload;
    expect(task.kind === 'export' && task.units[0]!.source).toBe(model);
    expect(task.kind === 'export' && task.units[0]!.transform).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0] });
    worker.done(0, { kind: 'files', files: [{ fileName: 'a.stl', buffer: new ArrayBuffer(84) }], units: [] });
    await expect(files).resolves.toMatchObject({ revision: 1, files: [{ fileName: 'a.stl' }], units: [] });
    expect(worker.terminated).toBe(true);
  });

  it('cancels an export through its signal', async () => {
    const { client } = setup('per-job');
    const controller = new AbortController();
    const files = client.exportFiles([], [], label, () => {}, controller.signal);
    controller.abort();
    await expect(files).rejects.toSatisfy((error) => (error as Error).name === 'AbortError');
  });
});
