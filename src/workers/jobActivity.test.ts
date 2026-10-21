import { beforeEach, describe, expect, it } from 'vitest';
import { CANCEL_LINGER_MS, ERROR_LINGER_MS, fractionOf, JobActivity, LONG_JOB_MS, MIN_VISIBLE_MS, SHOW_DELAY_MS } from './jobActivity';

let now = 0;
let activity: JobActivity;
beforeEach(() => {
  now = 1000;
  activity = new JobActivity(() => now);
});
const label = { key: 'Importing {name}', vars: { name: 'a.stl' } };

describe('job activity (NN/g response-time rules)', () => {
  it('shows nothing for a job under the show delay, so fast jobs never flash a loader', () => {
    const job = activity.begin({ label });
    expect(activity.view()).toEqual([]);
    now += SHOW_DELAY_MS - 1;
    job.end();
    now += 1;
    expect(activity.view()).toEqual([]);
    expect(activity.hasJobs()).toBe(false);
  });

  it('shows an indeterminate row after the delay, and keeps it at least the minimum time', () => {
    const job = activity.begin({ label });
    now += SHOW_DELAY_MS;
    expect(activity.view()).toMatchObject([{ label, state: 'indeterminate', percent: null, cancellable: false }]);
    now += 100;
    job.end();
    expect(activity.view()).toMatchObject([{ state: 'done' }]);
    now += MIN_VISIBLE_MS - 100;
    expect(activity.view()).toEqual([]);
  });

  it('turns determinate with progress, with a stage, a percent and, once stable, the time left', () => {
    const job = activity.begin({ label });
    job.progress({ fraction: 0.1, stage: 'Welding vertices' });
    now += SHOW_DELAY_MS;
    expect(activity.view()).toMatchObject([{ state: 'determinate', percent: 10, stage: 'Welding vertices', remainingMs: null }]);
    now += 3600;
    job.progress({ fraction: 0.5 });
    // 40 % in 4 s from the first report: about 5 s for the remaining 50 %.
    expect(activity.view()[0]!.remainingMs).toBe(5000);
  });

  it('shows the elapsed time on a long job without progress', () => {
    activity.begin({ label });
    now += LONG_JOB_MS;
    expect(activity.view()[0]).toMatchObject({ state: 'indeterminate', showElapsed: true, elapsedMs: LONG_JOB_MS });
  });

  it('offers Cancel for a cancellable job and calls it once', () => {
    let cancelled = 0;
    const job = activity.begin({ label, cancel: () => { cancelled += 1; } });
    now += SHOW_DELAY_MS;
    const [row] = activity.view();
    expect(row!.cancellable).toBe(true);
    expect(activity.cancel(row!.id)).toBe(true);
    expect(activity.cancel(row!.id)).toBe(false);
    expect(cancelled).toBe(1);
    expect(activity.view()[0]).toMatchObject({ cancellable: false, cancelling: true });
    job.end(new DOMException('aborted', 'AbortError'));
    expect(activity.view()[0]).toMatchObject({ state: 'cancelled' });
    now += CANCEL_LINGER_MS;
    expect(activity.view()).toEqual([]);
  });

  it('never fails silently: a failure shows even when the job was too quick to appear, then lingers', () => {
    const job = activity.begin({ label });
    const error = Object.assign(new Error('Import timed out after 300000 ms'), { code: 'timeout' });
    job.end(error);
    expect(activity.view()).toMatchObject([{ state: 'failed', error: { code: 'timeout', message: 'Import timed out after 300000 ms' } }]);
    now += ERROR_LINGER_MS;
    expect(activity.view()).toEqual([]);
  });

  it('lets a failure be dismissed', () => {
    activity.begin({ label }).end(new Error('boom'));
    const [row] = activity.view();
    activity.dismiss(row!.id);
    expect(activity.view()).toEqual([]);
  });

  it('lists every running job in one place and marks blocking ones', () => {
    activity.begin({ label, blocking: true });
    activity.begin({ label: { key: 'Building supports for {name}', vars: { name: 'A' } } });
    now += SHOW_DELAY_MS;
    expect(activity.view().map((row) => row.blocking)).toEqual([true, false]);
  });

  it('notifies subscribers of every change', () => {
    let calls = 0;
    const stop = activity.subscribe(() => { calls += 1; });
    const job = activity.begin({ label });
    job.progress({ fraction: 0.5 });
    job.end();
    stop();
    activity.begin({ label });
    expect(calls).toBe(3);
  });

  it('reads a fraction from fraction, loaded/total or done/total', () => {
    expect(fractionOf({ fraction: 1.5 })).toBe(1);
    expect(fractionOf({ loaded: 5, total: 10 })).toBe(0.5);
    expect(fractionOf({ done: 1, total: 4 })).toBe(0.25);
    expect(fractionOf({ stage: 'x' })).toBeNull();
  });
});
