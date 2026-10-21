import { describe, expect, it } from 'vitest';
import { createStrokeQueue, type QueuedStep } from './strokeQueue';
import type { BrushMode } from './types';

/** A fake hit test over `total` supports: each step hits ids `s<index>` it passes, `perCall` at a time. */
function tester(total: number, perCall = total) {
  const calls: { mode: BrushMode; radius: number; start: number }[] = [];
  const test = (step: QueuedStep) => {
    calls.push({ mode: step.mode, radius: step.radius, start: step.next });
    const end = Math.min(total, step.next + perCall);
    const hits: string[] = [];
    for (let index = step.next; index < end; index++) hits.push(`${step.to[0]}:${index}`);
    return { hits, next: end };
  };
  return { calls, test };
}

describe('stroke queue (Drag over steps waiting for hit tests)', () => {
  it('chains each step from the last point of the stroke', () => {
    const queue = createStrokeQueue();
    queue.begin();
    queue.push([1, 1], 'select', 24);
    queue.push([5, 1], 'select', 24);
    expect(queue.steps.map((step) => [step.from, step.to])).toEqual([[undefined, [1, 1]], [[1, 1], [5, 1]]]);
    queue.begin();
    queue.push([9, 9], 'select', 24);
    expect(queue.steps[2]!.from).toBeUndefined();
  });

  it('a step keeps the brush mode and radius it was made with (switching to Unselect mid-queue does not unselect the old stroke\'s remainder)', () => {
    const queue = createStrokeQueue();
    const { calls, test } = tester(4, 2);
    const commits: [string[], BrushMode][] = [];
    queue.begin();
    queue.push([1, 0], 'select', 24);
    // Frame 1 runs out of time half way through the step.
    queue.drain(4, test, (ids, mode) => commits.push([[...ids], mode]), () => false);
    expect(queue.steps).toHaveLength(1);
    // The user switches to Unselect and a smaller circle, then strokes again.
    queue.begin();
    queue.push([2, 0], 'unselect', 8);
    while (queue.pending) queue.drain(4, test, (ids, mode) => commits.push([[...ids], mode]), () => false);
    expect(calls.map(({ mode, radius }) => [mode, radius])).toEqual([['select', 24], ['select', 24], ['unselect', 8], ['unselect', 8]]);
    expect(commits).toEqual([[['1:0', '1:1'], 'select'], [['1:2', '1:3'], 'select'], [['2:0', '2:1'], 'unselect'], [['2:2', '2:3'], 'unselect']]);
    expect(queue.pending).toBe(false);
  });

  it('commits a frame\'s hits once per brush mode, each id once', () => {
    const queue = createStrokeQueue();
    const commits: [string[], BrushMode][] = [];
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.push([1, 0], 'select', 24);
    queue.drain(2, tester(2).test, (ids, mode) => commits.push([[...ids], mode]), () => false);
    expect(commits).toEqual([[['1:0', '1:1'], 'select']]);
    expect(queue.painted.has('1:1')).toBe(true);
  });

  it('a support-mesh rebuild keeps the queued steps and restarts them on the new supports', () => {
    const queue = createStrokeQueue();
    const { calls, test } = tester(6, 2);
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.push([3, 0], 'select', 24);
    queue.drain(6, test, () => {}, () => false);
    expect(queue.steps[0]!.next).toBe(2);
    queue.rebase();
    expect(queue.steps.map((step) => step.next)).toEqual([0, 0]);
    expect(queue.pending).toBe(true);
    while (queue.pending) queue.drain(6, test, () => {}, () => false);
    expect(calls.filter((call) => call.start === 0)).toHaveLength(3);
    // Painted ids stay painted: the host's skip test still sees them after the rebuild.
    expect(queue.painted.has('1:0')).toBe(true);
  });

  it('drops everything when the brush goes away', () => {
    const queue = createStrokeQueue();
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.clear();
    expect(queue.pending).toBe(false);
    queue.push([2, 0], 'select', 24);
    expect(queue.steps[0]!.from).toBeUndefined();
  });

  it('a new Unselect stroke over ids the old Select stroke is still painting ends with them unselected', () => {
    const queue = createStrokeQueue();
    const selected = new Set<string>();
    // The host's selection follows each commit (as the selection prop does a render later).
    const commit = (ids: readonly string[], mode: BrushMode) => ids.forEach((id) => (mode === 'select' ? selected.add(id) : selected.delete(id)));
    const ids = ['a', 'b', 'c', 'd'];
    /** Both strokes pass over the same supports a–d, two per frame. */
    const test = (step: QueuedStep, want: (id: string) => boolean) => {
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
    const test = (_step: QueuedStep, want: (id: string) => boolean) => ({ hits: ['a'].filter(want), next: 1 });
    queue.begin();
    queue.push([1, 0], 'select', 24);
    queue.begin();
    queue.push([2, 0], 'unselect', 24);
    queue.drain(1, test, (ids, mode) => committed.push([[...ids], mode]), (id) => base.has(id));
    expect(committed).toEqual([[['a'], 'select'], [['a'], 'unselect']]);
  });
});
