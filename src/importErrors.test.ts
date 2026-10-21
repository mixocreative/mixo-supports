import { describe, expect, it } from 'vitest';
import { CodedError, ERROR_CONTEXTS, errorCode, errorStatus } from './editing/errors';
import { CapacityError } from './core/budget';
import { weldRawMesh } from './state/import';
import { codedJobError } from './workers/jobErrors';
import { WorkerTaskError } from './workers/WorkerTask';

declare global {
  interface ImportMeta {
    glob<T>(patterns: string[], options: { query: string; import: string; eager: true }): Record<string, T>;
  }
}

const WORKER_CLIENTS = import.meta.glob<string>(['./workers/*Client.ts'], { query: '?raw', import: 'default', eager: true });

// The import code and the worker clients (lane B owns them) still throw English messages;
// editing/errors recognises them so the status line is translated. These fail if a message changes
// without a code.
describe('job errors reach the status line as codes', () => {
  it('a model with non-finite vertices', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, Number.NaN, 1, 0]);
    let thrown: unknown;
    try {
      weldRawMesh({ name: 'Part 1', positions, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    } catch (error) {
      thrown = error;
    }
    expect(errorCode(thrown)).toBe('non-finite');
    expect(errorStatus('import', thrown, { name: 'part.glb' }).vars).toEqual({ name: 'part.glb' });
  });

  it('every worker failure reaches the status line as a code (WorkerTask codes, budget refusals)', () => {
    // The clients run on WorkerTask: a crash or restart is a WorkerTaskError code, mapped by codedJobError.
    expect(errorCode(codedJobError(new WorkerTaskError('Support building crashed', 'crashed')))).toBe('worker-stopped');
    expect(errorCode(codedJobError(new WorkerTaskError('Import restarted: x', 'restarted')))).toBe('worker-stopped');
    expect(errorCode(codedJobError(new WorkerTaskError('Import timed out after 300000 ms', 'timeout')))).toBe('timeout');
    const refused = codedJobError(new CapacityError('big.stl', 9_991_920, 6_000_000, 'web'));
    expect(errorStatus('import', refused, { name: 'big.stl' })).toEqual({ key: expect.stringContaining('{n}'), vars: { name: 'big.stl', n: (9_991_920).toLocaleString(), limit: (6_000_000).toLocaleString() } });
    // No client keeps a hand-written crash message of its own any more.
    for (const [file, code] of Object.entries(WORKER_CLIENTS)) expect(code, file).not.toMatch(/'[^'\n]*\bworker (stopped|failed)\b/i);
  });

  it('a stopped worker never asks for a page reload (the scene is not saved) and shows no raw English', () => {
    for (const context of ERROR_CONTEXTS) {
      const status = errorStatus(context, new CodedError('worker-stopped', 'Support building failed in the background worker.'), { name: 'a.stl' });
      expect(status.key, context).not.toMatch(/reload/i);
      expect(status.vars?.error, context).toBeUndefined();
    }
  });
});
