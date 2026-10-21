import { describe, expect, it } from 'vitest';
import { CodedError, ERROR_CODES, ERROR_CONTEXTS, errorCode, errorStatus } from './errors';

describe('errorCode', () => {
  it('reads the code of a coded error', () => {
    expect(errorCode(new CodedError('too-large', 'big'))).toBe('too-large');
  });

  it('recognises the errors the app throws today by name or message', () => {
    expect(errorCode(new Error('knot.stl has vertex coordinates that are not finite numbers (NaN or infinity); repair or re-export the model'))).toBe('non-finite');
    expect(errorCode(new Error('The import worker stopped.'))).toBe('worker-stopped');
    const timeout = new Error('the job ran out of time');
    timeout.name = 'TimeoutError';
    expect(errorCode(timeout)).toBe('timeout');
    expect(errorCode(new Error('Job timed out after 60000 ms'))).toBe('timeout');
    expect(errorCode(new Error('Offset is outside the bounds of the DataView'))).toBe('unknown');
    expect(errorCode('a string')).toBe('unknown');
  });
});

describe('errorStatus', () => {
  it('says what happened and what to do next, per job', () => {
    const unknown = new Error('bad header');
    for (const context of ERROR_CONTEXTS) {
      const status = errorStatus(context, unknown, { name: 'knot.stl' });
      // Two sentences: what happened, then the next step.
      expect(status.key.split('. ').length, `${context}: ${status.key}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('names the file and passes the raw message only for errors it does not know', () => {
    expect(errorStatus('import', new Error('bad header'), { name: 'knot.stl' })).toEqual({
      key: 'Could not read {name} as STL, GLB or glTF ({error}). Check the file or export it again, then import it.',
      vars: { name: 'knot.stl', error: 'bad header' },
    });
    const nonFinite = errorStatus('import', new Error('knot.stl has vertex coordinates that are not finite numbers'), { name: 'knot.stl' });
    expect(nonFinite.vars).toEqual({ name: 'knot.stl' });
  });

  it('carries the numbers of a too-large refusal', () => {
    const status = errorStatus('import', new CodedError('too-large', 'refused', { n: 9_000_000, limit: 6_000_000 }), { name: 'big.stl' });
    expect(status.vars).toEqual({ name: 'big.stl', n: 9_000_000, limit: 6_000_000 });
    expect(status.key).toContain('{limit}');
  });

  it('gives every job and code a message', () => {
    for (const context of ERROR_CONTEXTS) {
      for (const code of ERROR_CODES) {
        expect(errorStatus(context, new CodedError(code, 'x'), { name: 'a' }).key.length).toBeGreaterThan(20);
      }
    }
  });
});
