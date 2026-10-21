import type { StatusMessage } from './types';

/**
 * Support check results as the user sees them. A check that was replaced, cancelled or failed is
 * "incomplete", never "no spots": the status line must tell "not checked" from "checked, clean".
 */
export interface CheckTally {
  /** Spots that may print unsupported. */
  spots: number;
  /** Spots inside no-support zones (unsupported on purpose). */
  inZone: number;
  /** Units whose check did not finish. */
  incomplete: number;
}

/** Sums per-unit results; `undefined` is a unit whose check did not finish. */
export function tallyChecks(results: readonly ({ spots: number; inZone: number } | undefined)[]): CheckTally {
  return results.reduce<CheckTally>((sum, result) => (result
    ? { ...sum, spots: sum.spots + result.spots, inZone: sum.inZone + result.inZone }
    : { ...sum, incomplete: sum.incomplete + 1 }), { spots: 0, inZone: 0, incomplete: 0 });
}

/** The status line after Check for unsupported spots. */
export function checkStatus({ spots, inZone, incomplete }: CheckTally): StatusMessage {
  if (incomplete > 0) return { key: 'The check did not finish for 1 object: run it again.', other: 'The check did not finish for {n} objects: run it again.', vars: { n: incomplete } };
  if (spots + inZone === 0) return { key: 'No unsupported spots found.' };
  return { key: '1 spot may print unsupported: see Check supports.', other: '{n} spots may print unsupported: see Check supports.', vars: { n: spots + inZone } };
}

/** The status line after an export, with what its companion check found. */
export function exportStatus(files: string, { spots, inZone, incomplete }: CheckTally): StatusMessage {
  if (incomplete > 0) {
    return {
      key: 'Exported {files}, but the support check did not finish for 1 object: run Check supports.',
      other: 'Exported {files}, but the support check did not finish for {n} objects: run Check supports.',
      vars: { files, n: incomplete },
    };
  }
  // Spots inside no-support zones are left unsupported on purpose: not counted, only mentioned.
  if (spots > 0 && inZone > 0) return { key: 'Exported {files}. 1 spot may print unsupported ({m} more inside no-support zones): see Check supports.', other: 'Exported {files}. {n} spots may print unsupported ({m} more inside no-support zones): see Check supports.', vars: { files, n: spots, m: inZone } };
  if (spots > 0) return { key: 'Exported {files}. 1 spot may print unsupported: see Check supports.', other: 'Exported {files}. {n} spots may print unsupported: see Check supports.', vars: { files, n: spots } };
  if (inZone > 0) return { key: 'Exported {files}. 1 unsupported spot is inside a no-support zone.', other: 'Exported {files}. {n} unsupported spots are inside no-support zones.', vars: { files, n: inZone } };
  return { key: 'Exported {files}.', vars: { files } };
}

/**
 * Runs `start` for `key` unless a job for the same `token` (the unit version) is running, which is
 * joined instead: the user's check and an export's check of an unchanged unit share one run rather
 * than one replacing the other. A new token starts its own job.
 */
export function joinRun<T>(running: Map<string, { token: object; promise: Promise<T> }>, key: string, token: object, start: () => Promise<T>): Promise<T> {
  const current = running.get(key);
  if (current && current.token === token) return current.promise;
  const promise = start();
  running.set(key, { token, promise });
  const clear = () => {
    if (running.get(key)?.promise === promise) running.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}
