import { describe, expect, it, vi } from 'vitest';
import { createHoverProbe } from './hoverProbe';

/** A manual frame loop: `tick` runs the callbacks waiting for the next frame. */
function frames() {
  let next = 1;
  const waiting = new Map<number, () => void>();
  return {
    requestFrame: (run: () => void) => {
      waiting.set(next, run);
      return next++;
    },
    cancelFrame: (handle: number) => void waiting.delete(handle),
    tick: () => {
      const due = [...waiting.values()];
      waiting.clear();
      due.forEach((run) => run());
    },
    get waiting() { return waiting.size; },
  };
}

describe('createHoverProbe', () => {
  it('works the test out once per frame, for the latest pointer, however many moves came', () => {
    const loop = frames();
    const test = vi.fn((x: number) => x > 5);
    const answers: boolean[] = [];
    const probe = createHoverProbe({ test, requestFrame: loop.requestFrame, cancelFrame: loop.cancelFrame, onAnswer: (value) => answers.push(value) });
    [1, 2, 9].forEach((x) => probe.ask(x));
    expect(test).not.toHaveBeenCalled();
    expect(probe.answer).toBe(false);
    loop.tick();
    expect(test).toHaveBeenCalledTimes(1);
    expect(test).toHaveBeenCalledWith(9);
    expect(probe.answer).toBe(true);
    expect(answers).toEqual([true]);
    probe.ask(1);
    loop.tick();
    expect(answers).toEqual([true, false]);
  });

  it('reset cancels the wait and forgets the answer', () => {
    const loop = frames();
    const test = vi.fn(() => true);
    const probe = createHoverProbe({ test, requestFrame: loop.requestFrame, cancelFrame: loop.cancelFrame, onAnswer: () => {} });
    probe.ask();
    loop.tick();
    expect(probe.answer).toBe(true);
    probe.ask();
    probe.reset();
    expect(loop.waiting).toBe(0);
    loop.tick();
    expect(test).toHaveBeenCalledTimes(1);
    expect(probe.answer).toBe(false);
  });
});
