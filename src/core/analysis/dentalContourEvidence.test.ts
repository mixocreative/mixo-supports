import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStl } from '../import/stl';
import { placementMatrix, transformPositions } from '../transform';
import { proposeDentalSupportRegion } from './dentalRegion';
import { inspectContourIncidence } from './dentalContourEvidence';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('inspectContourIncidence', () => {
  it('returns exact two-sided source faces for both reference loops regardless of pose', () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const outer = inspectContourIncidence(mesh, region.outerEdges);
    const opening = inspectContourIncidence(mesh, region.openingEdges);
    expect(outer.kind).toBe('closed-loop');
    expect(opening.kind).toBe('closed-loop');
    if (outer.kind !== 'closed-loop' || opening.kind !== 'closed-loop') return;
    expect(outer.facePairs.length).toBe(2665 * 2);
    expect(opening.facePairs.length).toBe(339 * 2);
    expect(outer.facePairs.every((face) => face < mesh.indices.length / 3)).toBe(true);
    expect(opening.facePairs.every((face) => face < mesh.indices.length / 3)).toBe(true);
    const rotated = { ...mesh, positions: transformPositions(mesh.positions,
      placementMatrix({ position: [0, 0, 0], rotation: [0.8, -0.7, 1.3] })) };
    expect(inspectContourIncidence(rotated, region.outerEdges)).toEqual(outer);
    expect(inspectContourIncidence(rotated, region.openingEdges)).toEqual(opening);
  }, 30000);

  it('rejects a gap, a branch, and a contour edge without two source faces', () => {
    const mesh = { positions: new Float32Array([
      -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ]), indices: new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]) };
    expect(inspectContourIncidence(mesh, new Uint32Array([4, 5, 5, 6, 6, 7]))).toEqual({ kind: 'inconclusive', reason: 'not-one-simple-loop' });
    expect(inspectContourIncidence(mesh, new Uint32Array([4, 5, 5, 6, 6, 7, 7, 4, 4, 6]))).toEqual({ kind: 'inconclusive', reason: 'not-one-simple-loop' });
    expect(inspectContourIncidence(mesh, new Uint32Array([0, 1, 1, 6, 6, 0]))).toEqual({ kind: 'inconclusive', reason: 'not-two-sided-mesh-edge' });
  });
});
