import type { PathPreflightResult } from './pathPreflight';

export interface CandidateSelectionOptions<T> {
  origin: 'auto' | 'manual';
  maxCandidates: number;
  permitted: (candidate: T) => boolean;
  preflight: (candidate: T) => PathPreflightResult;
}

export type CandidateSelection<T> =
  | { kind: 'provisional'; candidate: T; screen: 'clear' | 'inconclusive'; checked: number }
  | { kind: 'manual'; candidate: T; screen: PathPreflightResult; checked: number }
  | { kind: 'unresolved'; reason: string; checked: number };

/** Deterministic bounded trial order; `provisional` always requires exact final-mesh review. */
export function chooseSupportCandidate<T>(original: T, alternatives: readonly T[],
  options: CandidateSelectionOptions<T>): CandidateSelection<T> {
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1) {
    return { kind: 'unresolved', reason: 'invalid-budget', checked: 0 };
  }
  if (options.origin === 'manual') {
    return { kind: 'manual', candidate: original, screen: options.preflight(original), checked: 1 };
  }
  const total = alternatives.length + 1;
  let checked = 0;
  for (let at = 0; at < Math.min(total, options.maxCandidates); at++) {
    const candidate = at === 0 ? original : alternatives[at - 1]!;
    if (!options.permitted(candidate)) continue;
    const screen = options.preflight(candidate);
    checked++;
    if (screen.status === 'inconclusive' &&
      (screen.reason === 'cancelled' || screen.reason === 'invalid-geometry' || screen.reason === 'query-budget')) {
      return { kind: 'unresolved', reason: screen.reason, checked };
    }
    if (screen.status !== 'blocked') {
      return { kind: 'provisional', candidate, screen: screen.status, checked };
    }
  }
  return { kind: 'unresolved', reason: total > options.maxCandidates ? 'candidate-budget' : 'all-blocked', checked };
}
