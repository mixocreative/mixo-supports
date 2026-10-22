import { describe, expect, it } from 'vitest';
import { createStrokeQueue, type BrushJob } from './strokeQueue';
import type { BrushMode } from './types';

/**
 * A fake hit test over `total` supports, `perCall` at a time: a step hits the ids `<to x>:<index>`
 * it passes that `want` lets through.
 */
function tester(total: number, perCall = total) {
  const calls: { from: BrushJob['from']; to: BrushJob['to']; mode: BrushMode; radius: number; start: number }[] = [];
  const test = (step: BrushJob, want: (id: string) => boolean) => {
    calls.push({ from: step.from, to: step.to, mode: step.mode, radius: step.radius, start: step.next });
    const end = Math.min(total, step.next + perCall);
    const hits: string[] = [];
    for (let index = step.next; index < end; index++) if (want(`${step.to[0]}:${index}`)) hits.push(`${step.to[0]}:${index}`);
    return { hits, next: end };
  };
  return { calls, test };
}

/** Commits recorded as [ids, mode]. */
function recorder() {
  const commits: [string[], BrushMode][] = [];
  return { commits, commit: (ids: readonly string[], mode: BrushMode) => commits.push([[...ids], mode]) };
}

describe('stroke queue (Drag over steps waiting for hit tests)', () => {
  it('chains each step from the last point of its stroke; a new stroke starts with no previous point', () => {
    const queue = createStrokeQueue();
    const { calls, test } = tester(1);
    queue.begin();
    queue.push([1, 1], 'select', 24);
    queue.push([5, 1], 'select', 24);
    queue.begin();
    queue.push([9, 9], 'select', 24);
    queue.drain(1, test, () => {}, () => false);
    expect(calls.map((call) => [call.from, call.to])).toEqual([[undefined, [1, 1]], [[1, 1], [5, 1]], [undefined, [9, 9]]]);
  });

  it('a stroke drained between two pointer moves goes on from its last point', () => {
    const queue = createStrokeQueue();
    const { calls, test } = tester(1);
    queue.begin();
    queue.push([1, 1], 'select', 24);
    queue.drain(1, test, () => {}, () => false);
    expect(queue.pending).toBe(false);
    queue.push([5, 1], 'select', 24);
    queue.drain(1, test, () => {}, () => false);
    expect(calls.map((call) => call.from)).toEqual([undefined, [1, 1]]);
  });

  it('a step keeps the brush mode and radius it was made with (switching to Unselect mid-queue does not unselect the old stroke\'s remainder)', () => {
    const queue = createStrokeQueue();
    const { calls, test } = tester(4, 2);
    const { commits, commit } = recorder();
    queue.begin();
    queue.push([1, 0], 'select', 24);
    // Frame 1 runs out of time half way through the step.
    queue.drain(4, test, commit, () => false);
    expect(queue.pending).toBe(true);
    // The user switches to Unselect and a smaller circle, then strokes again.
    queue.begin();
    queue.push([2, 0], 'unselect', 8);
    while (queue.pending) queue.drain(4, test, commit, (id) => id.startsWith('2:'));
    expect(calls.map(({ mode, radius }) => [mode, radius])).toEqual([['select', 24], ['select', 24], ['unselect', 8], ['unselect', 8]]);
    expect(commits).toEqual([[['1:0', '1:1'], 'select'], [['1:2', '1:3'], 'select'], [['2:0', '2:1'], 'unselect'], [['2:2', '2:3'], 'unselect']]);
  });

  it('commits a frame\'s hits once per brush mode; a stroke never paints an id twice', () => {
    const queue = createStrokeQueue();
    const { commits, commit } = recorder();
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.push([1, 0], 'select', 24);
    // The host's selection still lags: only the stroke's own painted set keeps the second step out.
    queue.drain(2, tester(2).test, commit, () => false);
    queue.push([1, 0], 'select', 24);
    queue.drain(2, tester(2).test, commit, () => false);
    expect(commits).toEqual([[['1:0', '1:1'], 'select']]);
  });

  it('a support-mesh rebuild keeps the queued steps and restarts them on the new supports', () => {
    const queue = createStrokeQueue();
    const { calls, test } = tester(6, 2);
    const { commits, commit } = recorder();
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.push([3, 0], 'select', 24);
    queue.drain(6, test, commit, () => false);
    queue.rebase();
    expect(queue.pending).toBe(true);
    while (queue.pending) queue.drain(6, test, commit, () => false);
    expect(calls.map((call) => [call.to[0], call.start])).toEqual([[1, 0], [1, 0], [1, 2], [1, 4], [3, 0], [3, 2], [3, 4]]);
    // Painted ids stay painted: the restarted step does not commit them again.
    expect(commits.flatMap(([ids]) => ids)).toEqual(['1:0', '1:1', '1:2', '1:3', '1:4', '1:5', '3:0', '3:1', '3:2', '3:3', '3:4', '3:5']);
  });

  it('drops everything when the brush goes away', () => {
    const queue = createStrokeQueue();
    const { calls, test } = tester(1);
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.clear();
    expect(queue.pending).toBe(false);
    queue.push([2, 0], 'select', 24);
    queue.drain(1, test, () => {}, () => false);
    expect(calls.map((call) => [call.from, call.to])).toEqual([[undefined, [2, 0]]]);
  });

  it('a new Unselect stroke over ids the old Select stroke is still painting ends with them unselected', () => {
    const queue = createStrokeQueue();
    const selected = new Set<string>();
    // The host's selection follows each commit (as the selection prop does a render later).
    const commit = (ids: readonly string[], mode: BrushMode) => ids.forEach((id) => (mode === 'select' ? selected.add(id) : selected.delete(id)));
    const ids = ['a', 'b', 'c', 'd'];
    /** Both strokes pass over the same supports a–d, two per frame. */
    const test = (step: BrushJob, want: (id: string) => boolean) => {
      const end = Math.min(ids.length, step.next + 2);
      return { hits: ids.slice(step.next, end).filter(want), next: end };
    };
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.drain(ids.length, test, commit, (id) => selected.has(id));
    expect([...selected]).toEqual(['a', 'b']);
    queue.begin();
    queue.push([1, 0], 'unselect', 24);
    while (queue.pending) queue.drain(ids.length, test, commit, (id) => selected.has(id));
    expect([...selected]).toEqual([]);
  });

  it('the selection a frame tests against includes what earlier steps of the same frame committed', () => {
    const queue = createStrokeQueue();
    const committed: [string[], BrushMode][] = [];
    const base = new Set<string>(); // the host's selection prop: stale for the whole frame
    const test = (_step: BrushJob, want: (id: string) => boolean) => ({ hits: ['a'].filter(want), next: 1 });
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.begin();
    queue.push([2, 0], 'unselect', 24);
    queue.drain(1, test, (ids, mode) => committed.push([[...ids], mode]), (id) => base.has(id));
    expect(committed).toEqual([[['a'], 'select'], [['a'], 'unselect']]);
  });
});
