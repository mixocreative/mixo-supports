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
  /** Ids the step's own stroke already painted (one set per stroke, shared by its steps). */
  painted: Set<string>;
}

/**
 * Drag over's work queue (framework-free; the viewport owns one per object and keeps it across
 * support-mesh rebuilds). Pointer moves only `push`; each frame `drain`s as much as the hit test
 * allows and carries the rest over, also after the release, so a stroke always completes.
 */
export interface StrokeQueue {
  readonly steps: readonly QueuedStep[];
  /** Ids the current stroke already painted. */
  readonly painted: ReadonlySet<string>;
  readonly pending: boolean;
  /** A new stroke: no previous point, a fresh painted set. Queued steps of the last stroke still drain, with their own set. */
  begin(): void;
  push(to: Point, mode: BrushMode, radius: number): void;
  /** The brush went away (tool, mode or object change): queued steps are dropped. */
  clear(): void;
  /** The supports were rebuilt (support indices changed): every queued step starts over on the new ones. */
  rebase(): void;
  /**
   * Tests queued steps in order until one stops before `total` (out of time: it goes on next
   * frame). Hits are committed once per run of steps with the same mode, each id once. `want` is
   * what a step may change: not yet painted by its stroke, and selected (by `isSelected`, the
   * host's selection, overlaid by what earlier steps of this drain hit) when it unselects,
   * unselected when it selects.
   */
  drain(
    total: number,
    test: (step: QueuedStep, want: (id: string) => boolean) => { hits: readonly string[]; next: number },
    commit: (ids: readonly string[], mode: BrushMode) => void,
    isSelected: (id: string) => boolean,
  ): void;
}

export function createStrokeQueue(): StrokeQueue {
  const steps: QueuedStep[] = [];
  let painted = new Set<string>();
  let last: Point | undefined;
  return {
    steps,
    get painted() { return painted; },
    get pending() { return steps.length > 0; },
    begin() {
      last = undefined;
      painted = new Set();
    },
    push(to, mode, radius) {
      steps.push({ from: last, to, next: 0, mode, radius, painted });
      last = to;
    },
    clear() {
      steps.length = 0;
      last = undefined;
      painted = new Set();
    },
    rebase() {
      for (const step of steps) step.next = 0;
    },
    drain(total, test, commit, isSelected) {
      const batch = createHitBatch();
      /** What this drain's hits did to the selection (the host's selection lags until it renders). */
      const hit = new Map<string, BrushMode>();
      const selectedNow = (id: string) => (hit.has(id) ? hit.get(id) === 'select' : isSelected(id));
      let mode: BrushMode | undefined;
      while (steps.length > 0) {
        const step = steps[0]!;
        if (batch.size > 0 && mode !== step.mode) commit(batch.take(), mode!);
        mode = step.mode;
        const adding = step.mode === 'select';
        const part = test(step, (id) => !step.painted.has(id) && selectedNow(id) !== adding);
        batch.add(part.hits);
        for (const id of part.hits) {
          step.painted.add(id);
          hit.set(id, step.mode);
        }
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
