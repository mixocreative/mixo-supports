import { remapDeleted } from '../core/analysis/placement';
import type { SupportPoint } from '../core/analysis/types';
import type { StatusMessage } from './types';

/**
 * What a regeneration did to an object's hand work: the supports the user added always stay;
 * a removal stays when its support is placed again (`kept`) or moves to the nearest new support
 * (`moved`), and is reset (`reset`) when no support is near its spot any more.
 */
export interface RegenReport {
  /** Supports the user added, kept. */
  added: number;
  /** Removals that still hide the support they named, or its nearest neighbour. */
  removed: number;
  /** Removals no new support matches: reset, they hide nothing. */
  reset: number;
}

/** The report for one placement landing on an object: `deleted` are its removals before, `points` the contacts just placed. */
export function regenReport(manual: number, deleted: readonly string[], points: readonly SupportPoint[], matchRadius: number): RegenReport {
  const ids = new Set(points.map((point) => point.id));
  // A removal is matched when its id names a new contact, or was re-keyed onto the nearest new one.
  const matched = remapDeleted(deleted, points, matchRadius).filter((id) => ids.has(id)).length;
  return { added: manual, removed: matched, reset: Math.max(0, new Set(deleted).size - matched) };
}

/** Hand work worth a report: nothing is said when there was none to keep or reset. */
export const hasHandWork = (report: RegenReport): boolean => report.added + report.removed + report.reset > 0;

/** The status line while a regeneration runs, for what changed it (`placement`: a placement setting) and its scope. */
export function regeneratingStatus(scope: { n: number; name: string }, cause: 'button' | 'placement'): StatusMessage {
  return cause === 'placement'
    ? { key: 'Placement changed: regenerating {name}.', other: 'Placement changed: regenerating {n} objects.', vars: scope }
    : { key: 'Regenerating {name}.', other: 'Regenerating {n} objects.', vars: scope };
}

/** The status line (and the Undo toast) after a regeneration landed on an object. */
export function regeneratedStatus(name: string, placed: number, report: RegenReport): StatusMessage {
  if (!hasHandWork(report)) return { key: '{name}: {n} automatic contacts generated.', vars: { name, n: placed } };
  return { key: 'Regenerated {name}: {n} supports placed. Hand edits kept: {added} added, {removed} removed. Removals reset: {reset}.', vars: { name, n: placed, ...report } };
}

/** Settings edits come in bursts (typing a value): a placement change regenerates once it has been quiet this long. */
export const REGENERATE_DELAY_MS = 350;

/**
 * Units whose placement setting changed, waiting out the burst before they regenerate together.
 * `cancel` drops them (a mode took the supports over): the unit's placement then shows as pending
 * (`placementPending`) until the user regenerates.
 */
export class RegenerateQueue {
  private readonly ids = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly run: (ids: string[]) => void,
    private readonly onQueued: (queued: boolean) => void = () => {},
    private readonly delay = REGENERATE_DELAY_MS,
  ) {}

  schedule(ids: readonly string[]): void {
    if (ids.length === 0) return;
    ids.forEach((id) => this.ids.add(id));
    clearTimeout(this.timer);
    this.onQueued(true);
    this.timer = setTimeout(() => {
      const due = [...this.ids];
      this.ids.clear();
      this.timer = undefined;
      this.onQueued(false);
      if (due.length > 0) this.run(due);
    }, this.delay);
  }

  cancel(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.ids.clear();
    this.onQueued(false);
  }
}
