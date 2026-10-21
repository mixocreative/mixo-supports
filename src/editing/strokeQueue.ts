import { createHitBatch } from './selectionPaint';
import type { BrushMode } from './types';

type Point = readonly [number, number];

/** One Drag over pointer step waiting for its hit tests: the circle swept from → to, from support index `next`. */
export interface QueuedStep {
  from: Point | undefined;
  to: Point;
  next: number;
  /** The brush as it was when the step was made, not when it is tested. */
  mode: BrushMode;
  radius: number;
}

/**
 * Drag over's work queue (framework-free; the viewport owns one per object and keeps it across
 * support-mesh rebuilds). Pointer moves only `push`; each frame `drain`s as much as the hit test
 * allows and carries the rest over, also after the release, so a stroke always completes.
 */
export interface StrokeQueue {
  readonly steps: readonly QueuedStep[];
  /** Ids this stroke already painted: the host's hit test skips them (the selection prop lags a render). */
  readonly painted: ReadonlySet<string>;
  readonly pending: boolean;
  /** A new stroke: no previous point, nothing painted yet. Queued steps of the last stroke still drain. */
  begin(): void;
  push(to: Point, mode: BrushMode, radius: number): void;
  /** The brush went away (tool, mode or object change): queued steps are dropped. */
  clear(): void;
  /** The supports were rebuilt (support indices changed): every queued step starts over on the new ones. */
  rebase(): void;
  /**
   * Tests queued steps in order until one stops before `total` (out of time: it goes on next
   * frame). Hits are committed once per run of steps with the same mode, each id once.
   */
  drain(total: number, test: (step: QueuedStep) => { hits: readonly string[]; next: number }, commit: (ids: readonly string[], mode: BrushMode) => void): void;
}

export function createStrokeQueue(): StrokeQueue {
  const steps: QueuedStep[] = [];
  const painted = new Set<string>();
  let last: Point | undefined;
  return {
    steps,
    painted,
    get pending() { return steps.length > 0; },
    begin() {
      last = undefined;
      painted.clear();
    },
    push(to, mode, radius) {
      steps.push({ from: last, to, next: 0, mode, radius });
      last = to;
    },
    clear() {
      steps.length = 0;
      last = undefined;
      painted.clear();
    },
    rebase() {
      for (const step of steps) step.next = 0;
    },
    drain(total, test, commit) {
      const batch = createHitBatch();
      let mode: BrushMode | undefined;
      while (steps.length > 0) {
        const step = steps[0]!;
        if (batch.size > 0 && mode !== step.mode) commit(batch.take(), mode!);
        mode = step.mode;
        const part = test(step);
        batch.add(part.hits);
        for (const id of part.hits) painted.add(id);
        if (part.next < total) {
          step.next = part.next;
          break;
        }
        steps.shift();
      }
      if (batch.size > 0) commit(batch.take(), mode!);
    },
  };
}
