import { describe, expect, it } from 'vitest';
import { ProjectFileError, ProjectTooLarge } from '../editing/project';
import { JobActivity } from './jobActivity';
import { ProjectClient } from './projectClient';
import { serveTask } from './serveTask';
import type { WorkerLike } from './WorkerTask';

/** A worker that runs `handler` through the real serveTask, so errors cross as code and vars. */
function workerOf(handler: () => never): () => WorkerLike {
  return () => {
    const worker: WorkerLike = {
      onmessage: null, onerror: null, terminate: () => {},
      postMessage: (message) => { Promise.resolve().then(() => inbox.onmessage?.({ data: message })); },
    };
    const inbox = { onmessage: null as ((event: { data: unknown }) => unknown) | null, postMessage: (data: unknown) => { worker.onmessage?.({ data }); } };
    serveTask(handler, inbox);
    return worker;
  };
}
const file = new File(['x'], 'a.mixosupports');

describe('project client', () => {
  it('rebuilds a ProjectFileError and a ProjectTooLarge that crossed the worker boundary', async () => {
    const newer = new ProjectClient(workerOf(() => { throw new ProjectFileError('newer', 'Version 9', { v: 9, max: 1 }); }), new JobActivity());
    await expect(newer.open(file, 10)).rejects.toMatchObject({ name: 'ProjectFileError', code: 'newer', vars: { v: 9, max: 1 } });
    const big = new ProjectClient(workerOf(() => { throw new ProjectTooLarge(7, 5); }), new JobActivity());
    const error = await big.open(file, 5).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectTooLarge);
    expect(error).toMatchObject({ triangles: 7, limit: 5 });
  });
});
