import { describe, expect, it } from 'vitest';
import { CodedError, ERROR_CONTEXTS, errorCode, errorStatus } from './editing/errors';
import { weldRawMesh } from './state/import';

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

  it('every worker crash message the clients send is a worker-stopped code', () => {
    const messages = Object.values(WORKER_CLIENTS).flatMap((code) => [...code.matchAll(/'([^'\n]*\bworker\b[^'\n]*)'/gi)].map((match) => match[1]!))
      .filter((text) => / /.test(text) && !/\.ts$/.test(text));
    expect(messages.length).toBeGreaterThanOrEqual(3);
    for (const message of messages) expect(errorCode(new Error(message)), message).toBe('worker-stopped');
  });

  it('a stopped worker never asks for a page reload (the scene is not saved) and shows no raw English', () => {
    for (const context of ERROR_CONTEXTS) {
      const status = errorStatus(context, new CodedError('worker-stopped', 'Support building failed in the background worker.'), { name: 'a.stl' });
      expect(status.key, context).not.toMatch(/reload/i);
      expect(status.vars?.error, context).toBeUndefined();
    }
  });
});
