import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStl } from '../import/stl';
import { placementMatrix, transformPositions } from '../transform';
import { proposeDentalContours } from './dentalContours';
import { proposeDentalSupportRegion } from './dentalRegion';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('proposeDentalContours', () => {
  it('returns the existing exact edge sets without depending on face-region classification', () => {
    const mesh = reference();
    const expected = proposeDentalSupportRegion(mesh);
    const contours = proposeDentalContours(mesh);
    expect(expected.kind).toBe('proposal');
    expect(contours.kind).toBe('proposal');
    if (expected.kind !== 'proposal' || contours.kind !== 'proposal') return;
    expect(contours.outerEdges).toEqual(expected.outerEdges);
    expect(contours.outerRidgeEdges).toEqual(expected.outerRidgeEdges);
    expect(contours.outerConnectorEdges).toEqual(expected.outerConnectorEdges);
    expect(contours.openingEdges).toEqual(expected.openingEdges);
    const rotated = { ...mesh, positions: transformPositions(mesh.positions,
      placementMatrix({ position: [0, 0, 0], rotation: [1.1, -2.2, 0.7] })) };
    expect(proposeDentalContours(rotated)).toMatchObject({ kind: 'proposal',
      outerEdges: contours.outerEdges, openingEdges: contours.openingEdges });
  }, 30000);

  it('abstains on a non-aligner mesh', () => {
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
    expect(proposeDentalContours(mesh).kind).toBe('inconclusive');
  });
});
