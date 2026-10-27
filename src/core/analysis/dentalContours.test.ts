import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placementMatrix, transformPositions } from '../transform';
import { inspectDentalCentralOpening, proposeDentalContours } from './dentalContours';
import { proposeDentalOrientation } from './dental';
import { proposeDentalSupportRegion } from './dentalRegion';
import { parseStl } from '../../../scripts/test-support/rustImport';

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

  it('distinguishes the reference opening from a clean projected no-hole solid', () => {
    const mesh = reference();
    const orientation = proposeDentalOrientation(mesh);
    expect(orientation.kind).toBe('proposal');
    if (orientation.kind !== 'proposal') return;
    const present = inspectDentalCentralOpening(mesh, orientation.rim);
    expect(present.kind).toBe('present');
    if (present.kind === 'present') expect(present.edges.length / 2).toBe(339);

    const cube = {
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
    expect(inspectDentalCentralOpening(cube, orientation.rim)).toEqual({ kind: 'absent' });
    const broken = { ...cube, indices: cube.indices.slice(3) };
    expect(inspectDentalCentralOpening(broken, orientation.rim)).toEqual({ kind: 'ambiguous', reason: 'invalid-mesh' });
  }, 30000);
});
