import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DentalRim } from '../core/analysis/dental';
import type { DentalPlacementJob } from '../core/jobs';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import type { PlacementResult } from '../core/analysis/types';
import { filterDentalPlacement } from './placement';
import { decodeProject, encodeProject } from '../state/projectFile';
import { emptyScene, identityTransform, reduceScene, type PrintUnit } from '../state/project';
import { parseStl } from '../../scripts/test-support/rustImport';
import { dentalPolicyOf } from '../../scripts/test-support/dentalPolicyOf';
import { REFERENCE_PROFILE, referenceTuning } from '../../scripts/test-support/referenceProfile';
import { UNSAVED_TUNING } from './tuning';

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
  const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
  if (region.kind !== 'proposal') throw new Error('reference must yield a region');
  const job = (dental: DentalPolicy): DentalPlacementJob => ({ mesh, orientation: { position: [0, 0, 0], rotation: [0, 0, 0] }, settings, dental });
  const saved = (patch: Partial<Extract<DentalPolicy, { kind: 'two-contour' }>> = {}): DentalPolicy =>
    ({ kind: 'two-contour', profileId: REFERENCE_PROFILE, rim, region, stamps: [], ...patch });

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
    expect(filterDentalPlacement(job(saved({ tuning: { positionMm: 0.7, stripWidthMm: 0.4, density: 1.5 } })), empty).points).toEqual([]);
  }, 60000);

  it('loads an old-format project (no aligner profile, stored gap alternates) and recomputes it on use', () => {
    const unit = { id: 'unit-a', name: 'A', source: mesh, transform: identityTransform, settings: { preset: 'CUSTOM' },
      placement: empty, manual: [], deleted: [], contactSettings: {}, zones: [] } as unknown as PrintUnit;
    // A rim the project loader accepts (the placement itself does not read it for a two-contour area).
    const storedRim: DentalRim = { ...rim, points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), visibilityMask: new Uint8Array([1]),
      visibilityResolution: 1, visibilityMin: [-1, -1], visibilityMax: [1, 1] };
    // Saved before tunings were stored: the strip was detected at the defaults of the time.
    const oldRegion = proposeDentalSupportRegion(mesh, UNSAVED_TUNING, REFERENCE_PROFILE);
    if (oldRegion.kind !== 'proposal') throw new Error('reference must yield a region');
    const scene = reduceScene(reduceScene(emptyScene, { type: 'unit/add', unit }), { type: 'dental/set', unitId: 'unit-a', policy: saved({ rim: storedRim, region: oldRegion }) });
    // Write the file the way projects were saved before profiles: no profileId, provisional alternates listed.
    const file = JSON.parse(encodeProject(scene)) as { scene: { units: { dental: Record<string, unknown> }[] } };
    const dental = file.scene.units[0]!.dental;
    expect(dental.profileId).toBe(REFERENCE_PROFILE);
    delete dental.profileId;
    dental.gapAlternateIds = ['auto-1_2_3'];
    const loaded = decodeProject(JSON.stringify(file)).units[0]!.dental!;
    expect(loaded.profileId).toBe(REFERENCE_PROFILE);
    expect('gapAlternateIds' in loaded).toBe(false);
    expect(loaded.kind === 'two-contour' && loaded.tuning).toEqual(UNSAVED_TUNING);
    // The placement is the policy's own candidates, recomputed for the job's plate normal.
    const candidates = dentalPolicyOf(mesh, loaded).candidates.length;
    expect(candidates).toBeGreaterThan(0);
    expect(filterDentalPlacement(job(loaded), empty).points.length).toBe(candidates);
    // A tuning saved as a setback reads as the same strip, so it still reproduces.
    dental.tuning = { setbackMm: 0.2, stripWidthMm: 1, density: 1 };
    expect(filterDentalPlacement(job(decodeProject(JSON.stringify(file)).units[0]!.dental!), empty).points.length).toBe(candidates);
    // An aligner type no profile file defines is refused, not guessed.
    dental.profileId = 'retired-aligner';
    expect(() => decodeProject(JSON.stringify(file))).toThrow('unknown aligner profile');
  }, 60000);
});
