import { describe, expect, it } from 'vitest';
import { JobActivity } from './jobActivity';
import { REPLACED, WorkerTask, type WorkerLike } from './WorkerTask';
import { serveTask, transferable } from './serveTask';

/** Stand-in for a browser Worker: records posts; the test answers with reply() or crash(). */
class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string; preventDefault?(): void }) => void) | null = null;
  posts: { data: { id: number; type: string; payload: unknown; revision?: number }; transfer: Transferable[] | undefined }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(data: unknown, transfer?: Transferable[]): void {
    this.posts.push({ data: data as FakeWorker['posts'][number]['data'], transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(message: unknown): void {
    this.onmessage?.({ data: message });
  }
  crash(message = 'boom'): void {
    this.onerror?.({ message, preventDefault() {} });
  }
  get last() {
    return this.posts[this.posts.length - 1]!.data;
  }
}

const fresh = () => {
  FakeWorker.all = [];
  return () => new FakeWorker();
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const code = (error: unknown) => (error as { code?: string }).code;

describe('WorkerTask (mixomesh contract)', () => {
  it('resolves with the done result and passes the transfer list', async () => {
    const task = new WorkerTask<{ a: number }, number>({ create: fresh() });
    const buffer = new ArrayBuffer(8);
    const job = task.run({ a: 1 }, { transfer: [buffer] });
    const worker = FakeWorker.all[0]!;
    expect(worker.posts[0]!.transfer).toEqual([buffer]);
    expect(worker.last.type).toBe('run');
    expect(worker.last.payload).toEqual({ a: 1 });
    worker.reply({ id: worker.last.id, type: 'done', result: 42 });
    await expect(job).resolves.toBe(42);
  });

  it('forwards progress to onProgress', async () => {
    const task = new WorkerTask<object, string>({ create: fresh() });
    const seen: object[] = [];
    const job = task.run({}, { onProgress: (fields) => seen.push(fields) });
    const worker = FakeWorker.all[0]!;
    worker.reply({ id: worker.last.id, type: 'progress', fraction: 0.5, stage: 'Welding vertices' });
    worker.reply({ id: worker.last.id, type: 'done', result: 'ok' });
    await job;
    expect(seen).toEqual([{ fraction: 0.5, stage: 'Welding vertices' }]);
  });

  it('rejects with the message of an error reply', async () => {
    const task = new WorkerTask({ create: fresh() });
    const job = task.run({});
    const worker = FakeWorker.all[0]!;
    worker.reply({ id: worker.last.id, type: 'error', message: 'nope' });
    await expect(job).rejects.toThrow('nope');
  });

  it('rejects with AbortError on abort and ignores a late done', async () => {
    const task = new WorkerTask({ create: fresh() });
    const controller = new AbortController();
    const job = task.run({}, { signal: controller.signal });
    const worker = FakeWorker.all[0]!;
    const { id } = worker.last;
    controller.abort();
    await expect(job).rejects.toSatisfy(isAbort);
    worker.reply({ id, type: 'done', result: 1 });
  });

  it('rejects an already aborted signal without posting', async () => {
    const task = new WorkerTask({ create: fresh() });
    const controller = new AbortController();
    controller.abort();
    await expect(task.run({}, { signal: controller.signal })).rejects.toSatisfy(isAbort);
    expect(FakeWorker.all).toHaveLength(0);
  });

  it('times out: terminates the worker, other jobs reject restarted, the next run gets a new worker', async () => {
    const task = new WorkerTask<{ n: number }, number>({ create: fresh(), timeoutMs: 20 });
    const slow = task.run({ n: 1 });
    const other = task.run({ n: 2 }, { timeoutMs: 10_000 });
    await expect(slow).rejects.toSatisfy((error) => code(error) === 'timeout');
    await expect(other).rejects.toSatisfy((error) => code(error) === 'restarted');
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    const next = task.run({ n: 3 });
    expect(FakeWorker.all).toHaveLength(2);
    const worker = FakeWorker.all[1]!;
    worker.reply({ id: worker.last.id, type: 'done', result: 3 });
    await expect(next).resolves.toBe(3);
  });

  it('a crash rejects every running job and the next run starts a new worker', async () => {
    const task = new WorkerTask({ create: fresh() });
    const a = task.run({});
    const b = task.run({});
    FakeWorker.all[0]!.crash('kaput');
    await expect(a).rejects.toSatisfy((error) => /kaput/.test((error as Error).message) && code(error) === 'crashed');
    await expect(b).rejects.toThrow(/kaput/);
    const next = task.run({});
    expect(FakeWorker.all).toHaveLength(2);
    task.terminate();
    await expect(next).rejects.toSatisfy((error) => code(error) === 'restarted');
  });

  it('rejects a reply with a stale revision', async () => {
    const task = new WorkerTask({ create: fresh() });
    const job = task.run({}, { revision: 4 });
    const worker = FakeWorker.all[0]!;
    expect(worker.last.revision).toBe(4);
    worker.reply({ id: worker.last.id, type: 'done', result: 1, revision: 3 });
    await expect(job).rejects.toSatisfy((error) => code(error) === 'stale');
  });

  it('serial: posts the next job only after the previous one settles', async () => {
    const task = new WorkerTask<{ n: number }, number>({ create: fresh(), concurrency: 'serial' });
    const a = task.run({ n: 1 });
    const b = task.run({ n: 2 });
    await tick();
    const worker = FakeWorker.all[0]!;
    expect(worker.posts).toHaveLength(1);
    worker.reply({ id: worker.last.id, type: 'done', result: 1 });
    await expect(a).resolves.toBe(1);
    await tick();
    expect(worker.posts).toHaveLength(2);
    expect(worker.last.payload).toEqual({ n: 2 });
    worker.reply({ id: worker.last.id, type: 'done', result: 2 });
    await expect(b).resolves.toBe(2);
  });

  it('serial: a failed job does not block the queue', async () => {
    const task = new WorkerTask<{ n: number }, number>({ create: fresh(), concurrency: 'serial' });
    const a = task.run({ n: 1 });
    const b = task.run({ n: 2 });
    await tick();
    let worker = FakeWorker.all[0]!;
    worker.reply({ id: worker.last.id, type: 'error', message: 'bad' });
    await expect(a).rejects.toThrow('bad');
    await tick();
    worker = FakeWorker.all[FakeWorker.all.length - 1]!;
    worker.reply({ id: worker.last.id, type: 'done', result: 2 });
    await expect(b).resolves.toBe(2);
  });

  it('per-job: a fresh worker per job, terminated once the job settles', async () => {
    const task = new WorkerTask({ create: fresh(), mode: 'per-job' });
    const a = task.run({});
    const b = task.run({});
    expect(FakeWorker.all).toHaveLength(2);
    const [first, second] = FakeWorker.all as [FakeWorker, FakeWorker];
    first.reply({ id: first.last.id, type: 'done', result: 'a' });
    await expect(a).resolves.toBe('a');
    expect(first.terminated).toBe(true);
    expect(second.terminated).toBe(false);
    second.crash();
    await expect(b).rejects.toThrow();
  });

  it('runs the fallback when there is no Worker', async () => {
    const task = new WorkerTask<{ x: number }, number>({ create: null, fallback: (payload) => payload.x * 2 });
    await expect(task.run({ x: 21 })).resolves.toBe(42);
  });

  it('runs the fallback when creating the worker throws', async () => {
    const task = new WorkerTask({ create: () => { throw new Error('csp'); }, fallback: () => 'inline' });
    await expect(task.run({})).resolves.toBe('inline');
  });

  it('rejects without a worker or a fallback', async () => {
    const task = new WorkerTask({ create: null, name: 'thing' });
    await expect(task.run({})).rejects.toThrow(/thing requires a Web Worker/);
  });

  it('ignores messages for unknown ids', async () => {
    const task = new WorkerTask({ create: fresh() });
    const job = task.run({});
    const worker = FakeWorker.all[0]!;
    worker.reply({ id: 9999, type: 'done', result: 'x' });
    worker.reply(null);
    worker.reply({ id: worker.last.id, type: 'done', result: 'mine' });
    await expect(job).resolves.toBe('mine');
  });

  it('aborting the only job on a persistent worker restarts it, so leftover work cannot delay the next job', async () => {
    const task = new WorkerTask({ create: fresh() });
    const controller = new AbortController();
    const job = task.run({}, { signal: controller.signal });
    controller.abort();
    await expect(job).rejects.toSatisfy(isAbort);
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    const next = task.run({});
    expect(FakeWorker.all).toHaveLength(2);
    const worker = FakeWorker.all[1]!;
    worker.reply({ id: worker.last.id, type: 'done', result: 'ok' });
    await expect(next).resolves.toBe('ok');
  });

  it('aborting one of several jobs keeps the shared worker for the others', async () => {
    const task = new WorkerTask({ create: fresh() });
    const controller = new AbortController();
    const a = task.run({}, { signal: controller.signal });
    const b = task.run({});
    controller.abort();
    await expect(a).rejects.toSatisfy(isAbort);
    const worker = FakeWorker.all[0]!;
    expect(worker.terminated).toBe(false);
    worker.reply({ id: worker.posts[1]!.data.id, type: 'done', result: 'b' });
    await expect(b).resolves.toBe('b');
  });
});

describe('serveTask (worker side)', () => {
  function scope() {
    const posted: { message: Record<string, unknown>; transfer: Transferable[] | undefined }[] = [];
    const target = {
      onmessage: null as ((event: { data: unknown }) => unknown) | null,
      postMessage(message: unknown, transfer?: Transferable[]) {
        posted.push({ message: message as Record<string, unknown>, transfer });
      },
    };
    return { target, posted };
  }

  it('answers progress and done, echoing the revision and transferring wrapped buffers', async () => {
    const { target, posted } = scope();
    const buffer = new ArrayBuffer(4);
    serveTask<{ n: number }, unknown>((payload, { progress }) => {
      progress({ fraction: 0.5, stage: 'Welding vertices' });
      return transferable({ n: payload.n + 1, buffer }, [buffer]);
    }, target);
    await target.onmessage!({ data: { id: 7, type: 'run', payload: { n: 1 }, revision: 3 } });
    expect(posted[0]!.message).toEqual({ fraction: 0.5, stage: 'Welding vertices', id: 7, type: 'progress' });
    expect(posted[1]!.message).toEqual({ id: 7, type: 'done', result: { n: 2, buffer }, revision: 3 });
    expect(posted[1]!.transfer).toEqual([buffer]);
  });

  it('answers an error with its message and ignores other messages', async () => {
    const { target, posted } = scope();
    serveTask(() => { throw new Error('no model'); }, target);
    await target.onmessage!({ data: { type: 'other' } });
    await target.onmessage!({ data: { id: 1, type: 'run', payload: {} } });
    expect(posted).toEqual([{ message: { id: 1, type: 'error', message: 'no model' }, transfer: undefined }]);
  });
});

describe('WorkerTask progress reporting', () => {
  const later = () => new Promise((resolve) => setTimeout(resolve, 0));
  function setup() {
    let now = 0;
    const activity = new JobActivity(() => now);
    const task = new WorkerTask({ create: fresh(), activity, name: 'Import', label: { key: 'Working' } });
    return { activity, task, advance: (ms: number) => { now += ms; } };
  }

  it('reports each job under its label with the worker progress, and ends it', async () => {
    const { activity, task, advance } = setup();
    const job = task.run({}, { label: { key: 'Importing {name}', vars: { name: 'a.stl' } } });
    const worker = FakeWorker.all[0]!;
    worker.reply({ id: worker.last.id, type: 'progress', fraction: 0.25, stage: 'Welding vertices' });
    advance(500);
    expect(activity.view()).toMatchObject([{ label: { key: 'Importing {name}' }, state: 'determinate', percent: 25, stage: 'Welding vertices', cancellable: false }]);
    worker.reply({ id: worker.last.id, type: 'done', result: 1 });
    await job;
    await later();
    expect(activity.view()).toMatchObject([{ state: 'done' }]);
  });

  it('a cancellable job can be stopped from the activity list (AbortError)', async () => {
    const { activity, task, advance } = setup();
    const job = task.run({}, { cancellable: true });
    advance(500);
    activity.cancel(activity.view()[0]!.id);
    await expect(job).rejects.toSatisfy(isAbort);
    expect(FakeWorker.all[0]!.terminated).toBe(true);
  });

  it('a job replaced by its caller ends quietly, not as cancelled', async () => {
    const { activity, task, advance } = setup();
    const controller = new AbortController();
    const job = task.run({}, { signal: controller.signal });
    advance(500);
    activity.view();
    controller.abort(REPLACED);
    await expect(job).rejects.toSatisfy(isAbort);
    await later();
    expect(activity.view()[0]?.state).toBe('done');
  });

  it('a failure is reported with its code', async () => {
    const { activity, task } = setup();
    const job = task.run({}, { timeoutMs: 5 });
    await expect(job).rejects.toThrow();
    await later();
    expect(activity.view()).toMatchObject([{ state: 'failed', error: { code: 'timeout' } }]);
  });
});
