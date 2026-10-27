import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placementMatrix, transformPositions } from '../transform';
import { proposeDentalSupportRegion, retuneDentalSupportRegion } from './dentalRegion';
import { defaultDentalTuning } from './dentalTuning';
import { parseStl } from '../../../scripts/test-support/rustImport';

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
    expect(result.contactFaces).toBeInstanceOf(Uint8Array);
    expect(result.contactFaces?.reduce((sum, face) => sum + face, 0)).toBeLessThan(mesh.indices.length / 30);
    for (const contact of result.contacts ?? []) {
      expect(result.contactFaces?.[contact.face]).toBe(1);
      expect(result.allowedFaces[contact.face]).toBe(0);
    }
    expect(result.contacts?.length).toBeGreaterThan(70);
    expect(result.contacts?.length).toBeLessThan(130);
  }, 30000);

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

  it('keeps exact contours while tuning the non-cavity strip and contact density', () => {
    const mesh = reference();
    const baseline = proposeDentalSupportRegion(mesh);
    const tuned = proposeDentalSupportRegion(mesh, { ...defaultDentalTuning, setbackMm: 0.5,
      stripWidthMm: 0.4, density: 1.5 });
    expect(baseline.kind).toBe('proposal');
    expect(tuned.kind).toBe('proposal');
    if (baseline.kind !== 'proposal' || tuned.kind !== 'proposal') return;
    expect(tuned.outerEdges).toEqual(baseline.outerEdges);
    expect(tuned.openingEdges).toEqual(baseline.openingEdges);
    expect(tuned.allowedFaces).toEqual(baseline.allowedFaces);
    expect(tuned.contactFaces).not.toEqual(baseline.contactFaces);
    expect(tuned.contacts?.length).not.toBe(baseline.contacts?.length);
    for (const contact of tuned.contacts ?? []) expect(tuned.contactFaces?.[contact.face]).toBe(1);
  }, 45000);

  it('retunes the accepted contours to the same exact face and tip proposal as fresh detection', () => {
    const mesh = reference();
    const baseline = proposeDentalSupportRegion(mesh);
    expect(baseline.kind).toBe('proposal');
    if (baseline.kind !== 'proposal') return;
    const tuning = { setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 };
    const retuned = retuneDentalSupportRegion(mesh, baseline, tuning);
    const fresh = proposeDentalSupportRegion(mesh, tuning);
    expect(retuned).toEqual(fresh);
  }, 45000);

  it('keeps a thin, nonzero contact line on both reference rims at the minimum strip width', () => {
    const region = proposeDentalSupportRegion(reference(), { ...defaultDentalTuning, stripWidthMm: 0.2 });
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    expect(region.contacts?.filter((contact) => contact.rim === 'outer').length).toBeGreaterThan(0);
    expect(region.contacts?.filter((contact) => contact.rim === 'opening').length).toBeGreaterThan(0);
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
