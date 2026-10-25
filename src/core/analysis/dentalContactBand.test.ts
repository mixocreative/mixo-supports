import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStl } from '../import/stl';
import { placementMatrix, transformPositions } from '../transform';
import { proposeDentalSupportRegion } from './dentalRegion';
import { diagnosticDentalSideBands } from './dentalContactBand';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('diagnosticDentalSideBands', () => {
  it('traces separate narrow 3D surface strips on both sides of both contours', () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const result = diagnosticDentalSideBands(mesh, region, { setback: 0.2, width: 1.2 });
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    for (const [name, mask] of Object.entries({ outerOpeningSide: result.outerOpeningSide,
      outerOtherSide: result.outerOtherSide, innerOpeningSide: result.innerOpeningSide,
      innerOtherSide: result.innerOtherSide })) {
      const count = mask.reduce((sum, face) => sum + face, 0);
      expect(count, name).toBeGreaterThan(0);
      expect(count).toBeLessThan(mesh.indices.length / 3 / 4);
    }
    for (let face = 0; face < region.allowedFaces.length; face += 1) {
      expect(result.outerOpeningSide[face]! + result.outerOtherSide[face]!).toBeLessThanOrEqual(1);
      expect(result.innerOpeningSide[face]! + result.innerOtherSide[face]!).toBeLessThanOrEqual(1);
      if (result.outerOpeningSide[face] || result.innerOpeningSide[face]) expect(region.allowedFaces[face]).toBe(1);
      if (result.outerOtherSide[face] || result.innerOtherSide[face]) expect(region.allowedFaces[face]).toBe(0);
    }
    const rotated = { ...mesh, positions: transformPositions(mesh.positions,
      placementMatrix({ position: [0, 0, 0], rotation: [0.7, -1.1, 0.4] })) };
    const other = diagnosticDentalSideBands(rotated, region, { setback: 0.2, width: 1.2 });
    expect(other.kind).toBe('proposal');
    if (other.kind === 'proposal') expect(other.outerOtherSide).toEqual(result.outerOtherSide);
  }, 30000);
});
