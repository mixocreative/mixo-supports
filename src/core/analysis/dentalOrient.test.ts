import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { orientDentalAligner } from './dentalOrient';
import type { TriangleMesh } from './types';
import { parseStl } from '../../../scripts/test-support/rustImport';
import { REFERENCE_PROFILE } from '../../../scripts/test-support/referenceProfile';

const reference = (): TriangleMesh => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('orientDentalAligner (Step 1 detection)', () => {
  it('orients the reference aligner: proposal, pose, central opening present, mesh usable', () => {
    const result = orientDentalAligner(reference(), REFERENCE_PROFILE);
    expect(result.kind).toBe('oriented');
    if (result.kind !== 'oriented') return;
    expect(result.rotation).toBeDefined();
    expect(result.opening).toBe('present');
    expect(result.meshOk).toBe(true);
  });

  it('reports a mesh with a hole as unusable instead of trusting it', () => {
    const mesh = reference();
    const holed = { positions: mesh.positions, indices: mesh.indices.slice(0, mesh.indices.length - 3 * 40) };
    const result = orientDentalAligner(holed, REFERENCE_PROFILE);
    expect(result.meshOk).toBe(false);
  });

  it('fails a malformed mesh without throwing', () => {
    const result = orientDentalAligner({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }, REFERENCE_PROFILE);
    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid-mesh', meshOk: false });
  });
});
