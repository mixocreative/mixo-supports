import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placementMatrix, transformPositions } from '../../../scripts/test-support/matrix';
import { diagnosticDentalSideBands } from './dentalContactBand';
import { proposeDentalSupportRegion } from './dentalRegion';
import { sampleDiagnosticContourContacts } from './dentalContourContacts';
import { parseStl } from '../../../scripts/test-support/rustImport';
import { REFERENCE_PROFILE, referenceTuning } from '../../../scripts/test-support/referenceProfile';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('sampleDiagnosticContourContacts', () => {
  it('does not jump to a spatially closer but disconnected surface', () => {
    const mesh = {
      positions: new Float32Array([
        0, 0, 0, 2, 0, 0, 1, 2, 0, 1, 0, 2,
        0.2, 0.01, 0, 0.3, 0.01, 0, 0.25, 0.11, 0, 0.25, 0.01, 0.1,
      ]),
      indices: new Uint32Array([
        0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0,
        4, 5, 6, 4, 7, 5, 5, 7, 6, 6, 7, 4,
      ]),
    };
    const band = new Uint8Array([0, 1, 1, 1, 1, 0, 0, 0]);
    const result = sampleDiagnosticContourContacts(mesh, new Uint32Array([0, 1, 1, 2, 2, 0]), band,
      { spacing: 0.5, maxSearchDistance: 1.5 });
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    expect(result.contacts.length).toBeGreaterThan(0);
    expect(result.contacts.every((contact) => contact.face < 4)).toBe(true);
    const shifted = sampleDiagnosticContourContacts(mesh, new Uint32Array([0, 1, 1, 2, 2, 0]), band,
      { spacing: 0.5, phaseMm: 0.1, maxSearchDistance: 1.5 });
    expect(shifted.kind).toBe('proposal');
    if (shifted.kind === 'proposal') {
      expect(shifted.contacts.every((contact) => contact.face < 4)).toBe(true);
      expect(shifted.contacts[0]?.distanceAlongContour).toBeCloseTo(0.1, 6);
    }
  });

  it('samples exact source faces in a selected contour-side strip without granting production permission', () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const bands = diagnosticDentalSideBands(mesh, region, { setback: 0.2, width: 1.2 });
    expect(bands.kind).toBe('proposal');
    if (bands.kind !== 'proposal') return;
    const result = sampleDiagnosticContourContacts(mesh, region.outerEdges, bands.outerOtherSide,
      { spacing: 2, maxSearchDistance: 1.5 });
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    expect(result.contacts.length).toBeGreaterThan(20);
    expect(result.contacts.length).toBeLessThan(region.outerEdges.length / 2);
    expect(new Set(result.contacts.map((contact) => contact.face)).size).toBe(result.contacts.length);
    for (const contact of result.contacts) {
      expect(bands.outerOtherSide[contact.face]).toBe(1);
      expect(contact.position.every(Number.isFinite)).toBe(true);
      expect(contact.normal.every(Number.isFinite)).toBe(true);
      expect(contact.distanceAlongContour).toBeGreaterThanOrEqual(0);
    }
    const rotated = { ...mesh, positions: transformPositions(mesh.positions,
      placementMatrix({ position: [0, 0, 0], rotation: [0.7, -1.1, 0.4] })) };
    const moved = sampleDiagnosticContourContacts(rotated, region.outerEdges, bands.outerOtherSide,
      { spacing: 2, maxSearchDistance: 1.5 });
    expect(moved.kind).toBe('proposal');
    if (moved.kind === 'proposal') expect(moved.contacts.map((contact) => contact.face))
      .toEqual(result.contacts.map((contact) => contact.face));
  }, 30000);

  it('abstains on an invalid loop, wrong-sized mask, and invalid sampling settings', () => {
    const mesh = reference();
    const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const band = new Uint8Array(mesh.indices.length / 3);
    expect(sampleDiagnosticContourContacts(mesh, new Uint32Array([0, 1]), band,
      { spacing: 2, maxSearchDistance: 1.5 }).kind).toBe('inconclusive');
    expect(sampleDiagnosticContourContacts(mesh, region.outerEdges, new Uint8Array(2),
      { spacing: 2, maxSearchDistance: 1.5 }).kind).toBe('inconclusive');
    expect(sampleDiagnosticContourContacts(mesh, region.outerEdges, band,
      { spacing: -1, maxSearchDistance: 1.5 }).kind).toBe('inconclusive');
    expect(sampleDiagnosticContourContacts(mesh, region.outerEdges, band,
      { spacing: 2, phaseMm: 2, maxSearchDistance: 1.5 }).kind).toBe('inconclusive');
  }, 30000);
});
