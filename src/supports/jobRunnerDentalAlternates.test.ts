import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proposeDentalContactFootprint } from '../core/analysis/dentalContactFootprint';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import { positionId } from './contactEdits';
import type { SupportPoint } from '../core/analysis/types';
import type { DentalPlacementJob, JobTransform, SupportJob } from '../core/jobs';
import { defaultSupportSettings } from '../core/supports/settings';
import { runSupportJob } from './jobRunner';
import { filterDentalPlacement } from '../dental/placement';
import { parseStl } from '../../scripts/test-support/rustImport';
import { dentalPolicyOf } from '../../scripts/test-support/dentalPolicyOf';
import { REFERENCE_PROFILE, footprintSettings, fromBelow, referenceTuning } from '../../scripts/test-support/referenceProfile';

/*
 * Gap alternates are the policy's repair options (`PolicyResult.alternates`, made by Rust
 * `dental_policy` from the phase-zero samples of the exact strip), consumed by the `generate` repair
 * runner when a primary's support crosses the model (runner: Rust `generate` tests). They are never
 * extra primary tips: the preview and the permitted automatic contacts are the primaries only.
 */

const still: JobTransform = { position: [0, 0, 0], rotation: [0, 0, 0] };
const point = (id: string, position: [number, number, number], normal: [number, number, number]): SupportPoint =>
  ({ id, regionId: -1, position, normal, source: 'interior' });
let cached: ReturnType<typeof reference> | undefined;
function reference() {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
  if (region.kind !== 'proposal') throw new Error(`Reference region ${region.reason}`);
  // The policy samples for its frame's plate normal (+Y for the still frame used here).
  const phase = proposeDentalContactFootprint(mesh, region, { ...footprintSettings(), samplePhaseFraction: 0, fromBelow: fromBelow() });
  const primaries = proposeDentalContactFootprint(mesh, region, { ...footprintSettings(), fromBelow: fromBelow() });
  if (phase.kind !== 'proposal' || primaries.kind !== 'proposal') throw new Error('Reference footprint');
  return { mesh, region, phase, primaries: [...primaries.outerContacts, ...primaries.innerContacts] };
}
function fixture() { return cached ??= reference(); }
function policy(region: ReturnType<typeof fixture>['region']): Extract<DentalPolicy, { kind: 'two-contour' }> {
  return { kind: 'two-contour', profileId: REFERENCE_PROFILE, region, stamps: [], rim: {
    boundaryKind: 'projection-fallback', points: new Float32Array(), openingDirection: [0, -1, 0],
    centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array(),
    visibilityResolution: 0, visibilityMin: [0, 0], visibilityMax: [0, 0],
  } };
}

describe('dental gap alternates are repair options, not primaries', () => {
  it('offers exactly the phase-zero samples of the exact strip as alternates, each owned by one primary', () => {
    const { mesh, region, phase } = fixture();
    const made = dentalPolicyOf(mesh, policy(region));
    const phaseZero = [...phase.outerContacts, ...phase.innerContacts];
    expect(made.alternates.length).toBeGreaterThan(70);
    const primaries = new Set(made.candidates.map((c) => c.id));
    for (const alternate of made.alternates) {
      expect(primaries.has(alternate.owner)).toBe(true);
      expect(phaseZero.some((sample) => sample.face === alternate.face && sample.position.every((v, axis) => Math.abs(v - alternate.position[axis]!) < 1e-9))).toBe(true);
    }
    // The preview places the primaries only.
    const job: DentalPlacementJob = { mesh, orientation: still, dental: policy(region),
      settings: { overhangAngleDegrees: 45, spacing: 4, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false } };
    const empty = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
    const preview = filterDentalPlacement(job, empty);
    expect(preview.points).toHaveLength(fixture().primaries.length);
    const alternateIds = new Set(made.alternates.map((a) => positionId(a.position as [number, number, number])));
    expect(preview.points.some((p) => alternateIds.has(p.id))).toBe(false);
  }, 60000);

  it('builds an exact primary, never a contact standing on an alternate spot or a forged one, and never Roof or Cage', () => {
    const { mesh, region, phase } = fixture();
    const dental = policy(region);
    let lowest = Infinity;
    for (let at = 1; at < mesh.positions.length; at += 3) lowest = Math.min(lowest, mesh.positions[at]!);
    const frame: JobTransform = { position: [0, defaultSupportSettings.liftHeight - lowest, 0], rotation: [0, 0, 0] };
    const build = (candidate: SupportPoint, settings = defaultSupportSettings) =>
      runSupportJob({ mesh, frame, settings, dental,
        contacts: { points: [candidate], manual: [], deleted: [], zones: [], contactSettings: {} },
        labelText: 'A', mode: 'preview' } satisfies SupportJob);
    const primary = fixture().primaries[10]!;
    const exact = point(positionId(primary.position), primary.position, primary.normal);
    const built = build(exact);
    expect(built.dropped).not.toContain(exact.id);
    expect(built.components.some((component) => component.contactId === exact.id)).toBe(true);
    const cagePreset = build(exact, { ...defaultSupportSettings, roofMode: 'CAGE', roofSeededModes: ['CAGE'] });
    expect(cagePreset.components.some((component) =>
      ['roof', 'roof-brace', 'cage-ring', 'cross-bar'].includes(component.part))).toBe(false);
    const alternate = phase.outerContacts[10]!;
    const onAlternate = point(positionId(alternate.position), alternate.position, alternate.normal);
    expect(build(onAlternate).dropped).toContain(onAlternate.id);
    const forged = point('auto-forged', [primary.position[0] + 5, primary.position[1], primary.position[2]], primary.normal);
    expect(build(forged).dropped).toContain(forged.id);
  }, 120000);
});
