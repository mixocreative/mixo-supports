import { describe, expect, it, vi } from 'vitest';
import { emptyScene } from '../state/project';
import { JobActivity } from '../workers/jobActivity';
import { openProjectFile, type OpenHost } from './openProject';

const file = new File(['x'], 'knot.mixosupports');

let now = 1000;
function host(over: Partial<OpenHost> = {}) {
  const jobs = new JobActivity(() => now);
  const calls = { replace: vi.fn(), refused: vi.fn(), status: vi.fn() };
  const base: OpenHost = {
    jobs, runtime: 'web', read: async () => emptyScene, mode: () => 'off', hadObjects: () => false,
    replace: calls.replace, markSaved: () => {}, setStatusMessage: calls.status, offerUndo: () => {}, refused: calls.refused,
  };
  return { jobs, calls, host: { ...base, ...over } };
}

describe('open project', () => {
  it('ends its blocking job when a mode began while the file was read, and leaves the plate alone', async () => {
    let mode: 'off' | 'edit' = 'off';
    const { jobs, calls, host: h } = host({ read: async () => { mode = 'edit'; return emptyScene; }, mode: () => mode });
    await openProjectFile(file, h);
    expect(calls.refused).toHaveBeenCalledTimes(1);
    expect(calls.replace).not.toHaveBeenCalled();
    now += 60_000;
    expect(jobs.view()).toEqual([]);
  });

  it('ends its job and reports when the file cannot be read', async () => {
    const { jobs, calls, host: h } = host({ read: async () => { throw new Error('boom'); } });
    await openProjectFile(file, h);
    expect(calls.status).toHaveBeenCalledTimes(1);
    now += 60_000;
    expect(jobs.view()).toEqual([]);
  });

  it('says the models were not imported when they were dropped with the project', async () => {
    const { calls, host: h } = host();
    await openProjectFile(file, h, true);
    expect(calls.status).toHaveBeenCalledWith({ key: 'Open the project alone; models were not imported.' });
    expect(calls.replace).toHaveBeenCalledTimes(1);
  });
});
