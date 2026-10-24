import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStl } from '../import/stl';
import { placementMatrix, transformPositions } from '../transform';
import { proposeDentalSupportRegion } from './dentalRegion';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('proposeDentalSupportRegion', () => {
  it('finds two closed contours and the underside candidate on the approved reference', () => {
    const mesh = reference();
    const result = proposeDentalSupportRegion(mesh);
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    expect(result.outerEdges.length / 2).toBe(2665);
    expect(result.openingEdges.length / 2).toBe(339);
    expect(result.allowedFaces.length).toBe(mesh.indices.length / 3);
    expect(result.allowedFaces.reduce((sum, face) => sum + face, 0)).toBe(254344);
    expect(result.diagnostics.regionFaces).toEqual([254344, 119612]);
  });

  it('returns the same face classification after rotating the input mesh', () => {
    const mesh = reference();
    const original = proposeDentalSupportRegion(mesh);
    const rotated = proposeDentalSupportRegion({
      ...mesh,
      positions: transformPositions(mesh.positions, placementMatrix({ position: [0, 0, 0], rotation: [1.1, -2.2, 0.7] })),
    });
    expect(original.kind).toBe('proposal');
    expect(rotated.kind).toBe('proposal');
    if (original.kind !== 'proposal' || rotated.kind !== 'proposal') return;
    expect(rotated.allowedFaces).toEqual(original.allowedFaces);
  }, 30000);

  it('refuses a non-aligner mesh rather than authorizing contacts', () => {
    const mesh = {
      positions: new Float32Array([
        -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
        -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
      ]),
      indices: new Uint32Array([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
      ]),
    };
    expect(proposeDentalSupportRegion(mesh).kind).toBe('inconclusive');
  });
});
