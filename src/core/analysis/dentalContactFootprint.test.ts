import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placementMatrix, transformPositions } from '../../../scripts/test-support/matrix';
import { proposeDentalSupportRegion } from './dentalRegion';
import { proposeDentalContactFootprint } from './dentalContactFootprint';
import { parseStl } from '../../../scripts/test-support/rustImport';
import { REFERENCE_PROFILE, referenceTuning } from '../../../scripts/test-support/referenceProfile';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('proposeDentalContactFootprint', () => {
  it('keeps ridge contacts on exact narrow exterior-side faces, never the broad cavity region', () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const result = proposeDentalContactFootprint(mesh, region, {
      low: 0.2, high: 1.2, outerSpacing: 3, innerSpacing: 5, maxSearchDistance: 1.5, minTipSeparation: 0.6,
    });
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    const selected = result.contactFaces.reduce((sum, face) => sum + face, 0);
    expect(selected).toBeGreaterThan(0);
    expect(selected).toBeLessThan(mesh.indices.length / 3 / 10);
    for (const contact of [...result.outerContacts, ...result.innerContacts]) {
      expect(result.contactFaces[contact.face]).toBe(1);
      expect(region.allowedFaces[contact.face]).toBe(0);
    }
    expect(result.outerContacts.length).toBeGreaterThan(60);
    expect(result.innerContacts.length).toBeGreaterThan(10);
    expect(result.outerContacts.length + result.innerContacts.length).toBeLessThan(130);
  }, 30000);

  it('preserves selected source face IDs after arbitrary rotation', () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const settings = { low: 0.2, high: 1.2, outerSpacing: 3, innerSpacing: 5, maxSearchDistance: 1.5, minTipSeparation: 0.6 };
    const original = proposeDentalContactFootprint(mesh, region, settings);
    const rotated = { ...mesh, positions: transformPositions(mesh.positions,
      placementMatrix({ position: [0, 0, 0], rotation: [0.7, -1.1, 0.4] })) };
    const moved = proposeDentalContactFootprint(rotated, region, settings);
    expect(original.kind).toBe('proposal');
    expect(moved.kind).toBe('proposal');
    if (original.kind !== 'proposal' || moved.kind !== 'proposal') return;
    expect(moved.contactFaces).toEqual(original.contactFaces);
    expect(moved.outerContacts.map((contact) => contact.face)).toEqual(original.outerContacts.map((contact) => contact.face));
    expect(moved.innerContacts.map((contact) => contact.face)).toEqual(original.innerContacts.map((contact) => contact.face));
  }, 30000);

  it('recomputes a distinct phase-zero contact set only on the same approved strip', () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const settings = { low: 0.2, high: 1.2, outerSpacing: 3, innerSpacing: 2, maxSearchDistance: 1.5, minTipSeparation: 0.6 };
    const usual = proposeDentalContactFootprint(mesh, region, settings);
    const shifted = proposeDentalContactFootprint(mesh, region, { ...settings, samplePhaseFraction: 0 });
    expect(usual.kind).toBe('proposal');
    expect(shifted.kind).toBe('proposal');
    if (usual.kind !== 'proposal' || shifted.kind !== 'proposal') return;
    expect(shifted.contactFaces).toEqual(usual.contactFaces);
    expect(shifted.innerContacts[0]?.distanceAlongContour).toBe(0);
    expect(shifted.innerContacts.map((contact) => contact.position))
      .not.toEqual(usual.innerContacts.map((contact) => contact.position));
    for (const contact of [...shifted.outerContacts, ...shifted.innerContacts]) {
      expect(shifted.contactFaces[contact.face]).toBe(1);
      expect(region.allowedFaces[contact.face]).toBe(0);
    }
  }, 60000);
});
