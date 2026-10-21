import { CapacityError } from '../core/budget';
import { CodedError } from '../editing/errors';
import { WorkerTaskError } from './WorkerTask';

/**
 * Worker and budget failures as the shared error codes (src/editing/errors.ts), so the status line
 * explains them in the user's language: a refused size → 'too-large' (with the numbers), a timeout →
 * 'timeout', a crashed or restarted worker → 'worker-stopped'. Anything else passes through.
 */
export function codedJobError(error: unknown): unknown {
  if (error instanceof CapacityError) return new CodedError('too-large', error.message, { n: error.triangles.toLocaleString(), limit: error.limit.toLocaleString() });
  if (error instanceof WorkerTaskError && error.code === 'timeout') return new CodedError('timeout', error.message);
  if (error instanceof WorkerTaskError && (error.code === 'crashed' || error.code === 'restarted')) return new CodedError('worker-stopped', error.message);
  return error;
}
