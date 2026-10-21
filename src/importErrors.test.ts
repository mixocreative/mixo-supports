import { describe, expect, it } from 'vitest';
import { errorCode, errorStatus } from './editing/errors';
import { weldRawMesh } from './state/import';

// The import code (lane B owns it) still throws English messages; editing/errors recognises them so
// the status line is translated. This fails if that message changes without a code.
describe('import errors reach the status line as codes', () => {
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
});
