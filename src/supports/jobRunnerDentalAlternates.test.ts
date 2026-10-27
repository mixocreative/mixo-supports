import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultDentalContactFootprintSettings, proposeDentalContactFootprint } from '../core/analysis/dentalContactFootprint';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import { positionId } from '../../scripts/test-support/ts-oracle/placement/placement';
import type { SupportPoint } from '../core/analysis/types';
import type { DentalPlacementJob, JobTransform, SupportJob } from '../core/jobs';
import { defaultSupportSettings } from '../core/supports/settings';
import { runSupportJob } from './jobRunner';
import { filterDentalPlacement } from '../dental/placement';
import { parseStl } from '../../scripts/test-support/rustImport';

const still: JobTransform = { position: [0, 0, 0], rotation: [0, 0, 0] };
const point = (id: string, position: [number, number, number], normal: [number, number, number]): SupportPoint =>
  ({ id, regionId: -1, position, normal, source: 'interior' });
let cached: ReturnType<typeof reference> | undefined;
function reference() {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const region = proposeDentalSupportRegion(mesh);
  if (region.kind !== 'proposal') throw new Error(`Reference region ${region.reason}`);
  const phase = proposeDentalContactFootprint(mesh, region,
    { ...defaultDentalContactFootprintSettings, samplePhaseFraction: 0 });
  if (phase.kind !== 'proposal') throw new Error(`Reference phase ${phase.reason}`);
  return { mesh, region, phase };
}
function fixture() { return cached ??= reference(); }
function policy(region: ReturnType<typeof fixture>['region'], ids: string[]): Extract<DentalPolicy, { kind: 'two-contour' }> {
  return { kind: 'two-contour', region, gapAlternateIds: ids, stamps: [], rim: {
    boundaryKind: 'projection-fallback', points: new Float32Array(), openingDirection: [0, -1, 0],
    centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array(),
    visibilityResolution: 0, visibilityMin: [0, 0], visibilityMax: [0, 0],
  } };
}

describe('dental alternate primary parity', () => {
  it('previews only selected phase-zero points reproduced from the exact source strip', () => {
    const { mesh, region, phase } = fixture();
    const baselineIds = new Set(region.contacts!.map(({ position }) => positionId(position)));
    const alternate = phase.outerContacts.find(({ position }) => !baselineIds.has(positionId(position)));
    expect(alternate).toBeDefined();
    if (!alternate) return;
    const id = positionId(alternate.position);
    const dental = policy(region, [id]);
    const job: DentalPlacementJob = { mesh, orientation: still,
      settings: { overhangAngleDegrees: 45, spacing: 4, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false }, dental };
    const empty = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
    const preview = filterDentalPlacement(job, empty);
    expect(preview.points).toHaveLength(region.contacts!.length + 1);
    expect(preview.points.some((candidate) => candidate.id === id && candidate.position.every((value, axis) =>
      Math.abs(value - alternate.position[axis]!) < 1e-6))).toBe(true);
    expect(filterDentalPlacement({ ...job, dental: policy(region, ['auto-forged']) }, empty).points)
      .toHaveLength(region.contacts!.length);
  }, 60000);

  it('builds an exact selected primary while rejecting a mislabelled or forged one', () => {
    const { mesh, region, phase } = fixture();
    const alternate = phase.outerContacts[10]!;
    const id = positionId(alternate.position);
    const dental = policy(region, [id]);
    let lowest = Infinity;
    for (let at = 1; at < mesh.positions.length; at += 3) lowest = Math.min(lowest, mesh.positions[at]!);
    const frame: JobTransform = { position: [0, defaultSupportSettings.liftHeight - lowest, 0], rotation: [0, 0, 0] };
    const build = (candidate: SupportPoint, selected: DentalPolicy = dental, settings = defaultSupportSettings) =>
      runSupportJob({ mesh, frame, settings, dental: selected,
        contacts: { points: [candidate], manual: [], deleted: [], zones: [], contactSettings: {} },
        labelText: 'A', mode: 'preview' } satisfies SupportJob);
    const candidate = point(id, alternate.position, alternate.normal);
    const built = build(candidate);
    expect(built.dropped).not.toContain(id);
    expect(built.components.some((component) => component.contactId === id)).toBe(true);
    const cagePreset = build(candidate, dental,
      { ...defaultSupportSettings, roofMode: 'CAGE', roofSeededModes: ['CAGE'] });
    expect(cagePreset.components.some((component) =>
      ['roof', 'roof-brace', 'cage-ring', 'cross-bar'].includes(component.part))).toBe(false);
    const mislabelled = point('auto-999_999_999', alternate.position, alternate.normal);
    expect(build(mislabelled, policy(region, [mislabelled.id])).dropped).toContain(mislabelled.id);
    const forged = point('auto-forged', [alternate.position[0] + 5, alternate.position[1], alternate.position[2]], alternate.normal);
    expect(build(forged).dropped).toContain(forged.id);
  }, 60000);
});
