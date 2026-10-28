import { readFileSync } from 'node:fs';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import type { DentalPolicy } from '../../src/core/analysis/dentalPolicy';
import type { SupportJob } from '../../src/core/jobs';
import { defaultSupportSettings, type LiveSupportSettings } from '../../src/core/supports/settings';
import { filterDentalPlacement } from '../../src/dental/placement';
import { dentalStructureOf, dentalSupportSettings } from '../../src/dental/supportPreset';
import { parseStl } from '../node-engine';
import { REFERENCE_PROFILE, referenceTuning } from './referenceProfile';

/*
 * The reference aligner as a Step 3 unit, for the live-update bench (`scripts/perf/live-engine.ts`)
 * and the lift tests: region proposal, dental placement, the profile's Step 3 settings. A job's
 * frame puts the lowest point `liftHeight` above the plate, as a generate does.
 */

const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
export const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
if (region.kind !== 'proposal') throw new Error(`aligner region ${region.reason}`);
export const dental: DentalPolicy = {
  kind: 'two-contour', profileId: REFERENCE_PROFILE, region, stamps: [], tuning: referenceTuning, structure: dentalStructureOf(REFERENCE_PROFILE),
  rim: {
    boundaryKind: 'projection-fallback', points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), openingDirection: [0, 1, 0],
    centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array([0]),
    visibilityResolution: 1, visibilityMin: [-1, -1], visibilityMax: [1, 1],
  },
} as DentalPolicy;
const still = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
const empty = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
export const placed = filterDentalPlacement({ mesh, orientation: still, settings: { overhangAngleDegrees: 45, spacing: 4, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false }, dental }, empty);
let lowest = Infinity;
for (let at = 1; at < mesh.positions.length; at += 3) lowest = Math.min(lowest, mesh.positions[at]!);
/** The profile's Step 3 settings (lift 3.5 mm). */
export const base = dentalSupportSettings(REFERENCE_PROFILE, defaultSupportSettings);

/** A fresh generate's job: the frame places the lowest point `liftHeight` above the plate. */
export const jobAt = (settings: LiveSupportSettings, mode: SupportJob['mode'] = 'preview'): SupportJob => ({
  mesh, dental, frame: { position: [0, settings.liftHeight - lowest, 0], rotation: [0, 0, 0] }, settings,
  contacts: { points: placed.points, manual: [], deleted: [], zones: [], contactSettings: {} }, labelText: 'X', mode,
});

/**
 * The job after a lift change from `generatedAt` (what `liftCommands` stores): the generation frame
 * stays, the plate moves in it by the change.
 */
export const liftedJob = (settings: LiveSupportSettings, generatedAt: LiveSupportSettings, mode: SupportJob['mode'] = 'preview'): SupportJob => {
  const job = jobAt({ ...settings, liftHeight: generatedAt.liftHeight }, mode);
  const plate = generatedAt.liftHeight - settings.liftHeight;
  return { ...job, settings, ...(plate !== 0 ? { plate } : {}) };
};
