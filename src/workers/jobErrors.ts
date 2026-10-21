import { CapacityError, PlateFullError } from '../core/budget';
import { CodedError, ERROR_CODES, type ErrorCode } from '../editing/errors';
import { WorkerJobError, WorkerTaskError } from './WorkerTask';

/** Numbers formatted for the message (thousands separators in the user's locale). */
function formatted(vars: Record<string, string | number> | undefined): Record<string, string | number> {
  return Object.fromEntries(Object.entries(vars ?? {}).map(([key, value]) => [key, typeof value === 'number' ? value.toLocaleString() : value]));
}

const isErrorCode = (code: unknown): code is ErrorCode => typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code);

/**
 * Worker and budget failures as the shared error codes (src/editing/errors.ts), so the status line and
 * the job activity list explain them in the user's language:
 *   - a refused size or memory, a full plate, a damaged STL, broken vertices: their own code and numbers
 *     (thrown in the app, or in a worker and carried across by serveTask/WorkerTask);
 *   - a WorkerTask timeout → 'timeout'; a crashed or restarted worker, no Web Worker at all, or a
 *     reply for an older revision → 'worker-stopped'.
 * Anything else passes through unchanged.
 */
export function codedJobError(error: unknown): unknown {
  if (error instanceof CodedError) return error;
  if (error instanceof CapacityError || error instanceof PlateFullError) return new CodedError(error.code, error.message, formatted(error.vars));
  if (error instanceof WorkerTaskError) {
    if (error.code === 'timeout') return new CodedError('timeout', error.message);
    return new CodedError('worker-stopped', error.message);
  }
  const { code, vars } = (error ?? {}) as { code?: unknown; vars?: Record<string, string | number> };
  if (error instanceof Error && isErrorCode(code)) return new CodedError(code, error.message, formatted(vars));
  return error;
}

/** A job failure as the activity list stored it (code, message, values), rebuilt for errorStatus. */
export function rebuiltJobError(stored: { code: string | null; message: string; vars?: Record<string, string | number> }): unknown {
  if (stored.code === 'timeout' || stored.code === 'crashed' || stored.code === 'restarted' || stored.code === 'stale' || stored.code === 'unavailable') {
    return codedJobError(new WorkerTaskError(stored.message, stored.code));
  }
  return codedJobError(new WorkerJobError(stored.message, stored.code ?? undefined, stored.vars));
}
