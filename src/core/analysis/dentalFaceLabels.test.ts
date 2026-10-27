import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import labelData from '../../../docs/dental-reference/face-labels.json';
import { buildLabels } from '../../../scripts/test-support/dentalFaceLabels';
import { parseStl } from '../../../scripts/test-support/rustImport';
import { proposeDentalContactFootprint } from './dentalContactFootprint';
import { dentalRegionAllowedOnFace, type DentalPolicy } from './dentalPolicy';
import { proposeDentalSupportRegion } from './dentalRegion';
import { defaultDentalTuning, dentalFootprintSettings } from './dentalTuning';

/** Face labels of the reference aligner (docs/dental-reference/face-labels.json): tips and secondary landings on allowed faces only. */
interface Labels { faceCount: number; forbiddenFaceRuns: number[]; allowedFaceRuns: number[] }
const labels = labelData as Labels;

const expand = (runs: readonly number[], count: number): Uint8Array => {
  const mask = new Uint8Array(count);
  for (let at = 0; at < runs.length; at += 2) mask.fill(1, runs[at]!, runs[at]! + runs[at + 1]!);
  return mask;
};

describe('reference aligner face labels', () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const forbidden = expand(labels.forbiddenFaceRuns, labels.faceCount);
  const allowed = expand(labels.allowedFaceRuns, labels.faceCount);
  const region = proposeDentalSupportRegion(mesh);

  it('are the labels the detector produces now (regenerate with scripts/dental-face-labels.ts)', () => {
    expect(labels.faceCount).toBe(mesh.indices.length / 3);
    expect(buildLabels()).toEqual(expect.objectContaining({ faceCount: labels.faceCount,
      forbiddenFaceRuns: labels.forbiddenFaceRuns, allowedFaceRuns: labels.allowedFaceRuns }));
  }, 60000);

  it('keep allowed and forbidden faces disjoint and the strip narrow', () => {
    for (let face = 0; face < labels.faceCount; face += 1) expect(allowed[face]! & forbidden[face]!).toBe(0);
    const strip = allowed.reduce((sum, face) => sum + face, 0);
    expect(strip).toBeGreaterThan(0);
    expect(strip).toBeLessThan(labels.faceCount / 10);
  });

  it('put every tip on an allowed face and none on a forbidden one', () => {
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    expect(region.contacts!.length).toBeGreaterThan(70);
    const policy = { kind: 'two-contour', region, stamps: [] } as unknown as DentalPolicy;
    for (const contact of region.contacts!) {
      expect(allowed[contact.face], `tip on face ${contact.face}`).toBe(1);
      expect(forbidden[contact.face]).toBe(0);
      expect(dentalRegionAllowedOnFace(policy, contact.face, contact.position, contact.normal)).toBe(true);
    }
  });

  it('put every secondary landing candidate (the phase-zero alternates) on an allowed face', () => {
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const phase = proposeDentalContactFootprint(mesh, region, { ...dentalFootprintSettings(defaultDentalTuning), samplePhaseFraction: 0 });
    expect(phase.kind).toBe('proposal');
    if (phase.kind !== 'proposal') return;
    const policy = { kind: 'two-contour', region, stamps: [] } as unknown as DentalPolicy;
    const candidates = [...phase.outerContacts, ...phase.innerContacts];
    expect(candidates.length).toBeGreaterThan(70);
    for (const contact of candidates) {
      expect(allowed[contact.face], `landing on face ${contact.face}`).toBe(1);
      expect(forbidden[contact.face]).toBe(0);
      expect(dentalRegionAllowedOnFace(policy, contact.face, contact.position, contact.normal)).toBe(true);
    }
  }, 60000);

  it('refuse a face on the forbidden side even under an allow stamp', () => {
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const face = forbidden.indexOf(1);
    const policy = { kind: 'two-contour', region, stamps: [{ center: [0, 0, 0], radius: 1e6, normal: [0, 0, 1], kind: 'allow' }] } as unknown as DentalPolicy;
    expect(dentalRegionAllowedOnFace(policy, face, [0, 0, 0], [0, 0, 1])).toBe(false);
  });
});
