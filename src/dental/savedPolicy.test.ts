import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DentalRim } from '../core/analysis/dental';
import type { DentalPlacementJob } from '../core/jobs';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import type { PlacementResult } from '../core/analysis/types';
import { filterDentalPlacement } from './placement';
import { parseStl } from '../../scripts/test-support/rustImport';

/** A saved two-contour policy is recomputed from the mesh when it is used; it is never trusted as saved. */
const rim: DentalRim = {
  boundaryKind: 'projection-fallback', points: new Float32Array(), openingDirection: [0, -1, 0], centroid: [0, 0, 0],
  tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array(), visibilityResolution: 0, visibilityMin: [0, 0], visibilityMax: [0, 0],
};
const empty: PlacementResult = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
const settings = { overhangAngleDegrees: 45, spacing: 2, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false };

describe('saved dental policy on load', () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const region = proposeDentalSupportRegion(mesh);
  if (region.kind !== 'proposal') throw new Error('reference must yield a region');
  const job = (dental: DentalPolicy): DentalPlacementJob => ({ mesh, orientation: { position: [0, 0, 0], rotation: [0, 0, 0] }, settings, dental });
  const saved = (patch: Partial<Extract<DentalPolicy, { kind: 'two-contour' }>> = {}): DentalPolicy =>
    ({ kind: 'two-contour', rim, region, stamps: [], ...patch });

  it('accepts a saved policy that matches what the mesh yields now', () => {
    const result = filterDentalPlacement(job(saved()), empty);
    expect(result.points.length).toBe(region.contacts!.length);
  }, 60000);

  it('rejects a saved strip mask that was edited after saving', () => {
    const contactFaces = Uint8Array.from(region.contactFaces!);
    contactFaces[contactFaces.indexOf(0)] = 1;
    expect(filterDentalPlacement(job(saved({ region: { ...region, contactFaces } })), empty).points).toEqual([]);
  }, 60000);

  it('rejects a saved policy without a contact footprint (old projects are not grandfathered)', () => {
    const { contactFaces: _faces, contacts: _contacts, ...old } = region;
    expect(filterDentalPlacement(job(saved({ region: old })), empty).points).toEqual([]);
  }, 60000);

  it('rejects a saved footprint that no longer matches the tuning it is used with', () => {
    expect(filterDentalPlacement(job(saved({ tuning: { setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 } })), empty).points).toEqual([]);
  }, 60000);
});
