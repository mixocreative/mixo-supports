import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../core/analysis/types';
import type { ContactInputs, DentalPlacementJob, JobTransform, SupportJob } from '../core/jobs';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import type { ZoneStamp } from '../core/supports/zones';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import { readFileSync } from 'node:fs';
import { runSupportJob } from './jobRunner';
import { filterDentalPlacement } from '../dental/placement';
import { parseStl } from '../../scripts/test-support/rustImport';
import { REFERENCE_PROFILE, referenceTuning } from '../../scripts/test-support/referenceProfile';

type V = [number, number, number];

/** Outward-facing axis-aligned boxes as one mesh. */
function boxes(...list: [V, V][]): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [[x0, y0, z0], [x1, y1, z1]] of list) {
    const base = positions.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) positions.push(x!, y!, z!);
    for (const face of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) {
      indices.push(base + face[0]!, base + face[1]!, base + face[2]!, base + face[0]!, base + face[2]!, base + face[3]!);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const settings = { ...defaultSupportSettings, roofSeededModes: [], lowPolyMode: true } as LiveSupportSettings;
const point = (id: string, position: V, normal: V): SupportPoint => ({ id, regionId: 0, position, normal, source: 'interior' });
const job = (mesh: TriangleMesh, frame: JobTransform, contacts: ContactInputs): SupportJob => ({ mesh, frame, settings, contacts, labelText: 'A', mode: 'preview' });
const still: JobTransform = { position: [0, 0, 0], rotation: [0, 0, 0] };

describe('runSupportJob: zones are unit-local, landings are cast in the generation frame', () => {
  // A slab (top at y = 9) with a shelf above it (underside at y = 20), unit-local.
  const model = boxes([[-20, 5, -20], [20, 9, 20]], [[-5, 20, -5], [5, 24, 5]]);
  const zone: ZoneStamp = { center: [0, 9, 0], radius: 3, normal: [0, 1, 0], kind: 'paint' };
  const inputs = (zones: ZoneStamp[]): ContactInputs => ({
    // auto-shelf lands on the slab top under it; auto-slab (slab underside) goes down to the plate.
    points: [point('auto-shelf', [0, 20, 0], [0, -1, 0]), point('auto-slab', [15, 5, 0], [0, -1, 0])],
    manual: [point('manual-shelf', [2, 20, 2], [0, -1, 0])],
    deleted: [], zones, contactSettings: {},
  });

  it('reports the automatic contact whose column lands in the zone; manual ones stay', () => {
    expect(runSupportJob(job(model, still, inputs([]))).dropped).toEqual([]);
    expect(runSupportJob(job(model, still, inputs([zone]))).dropped).toEqual(['auto-shelf']);
  });

  it('maps the zones with the unit: moved on the plate, the same contact drops', () => {
    expect(runSupportJob(job(model, { position: [30, 2, -10], rotation: [0, 0, 0] }, inputs([zone]))).dropped).toEqual(['auto-shelf']);
  });

  it('casts down the plate, not unit-local Y: a unit stood up 90 degrees about X', () => {
    // The same shelf over slab, built along local -Z; Rx(90°) maps local (x, y, z) to plate (x, -z, y).
    const standing = boxes([[-20, -20, -9], [20, 20, -5]], [[-5, -5, -24], [5, 5, -20]]);
    const upright: JobTransform = { position: [0, 0, 0], rotation: [Math.PI / 2, 0, 0] };
    const contacts: ContactInputs = {
      points: [point('auto-shelf', [0, 0, -20], [0, 0, 1])], manual: [], deleted: [], contactSettings: {},
      zones: [{ center: [0, 0, -9], radius: 3, normal: [0, 0, -1], kind: 'paint' }],
    };
    expect(runSupportJob(job(standing, upright, contacts)).dropped).toEqual(['auto-shelf']);
    // Lying flat the shelf is beside the slab, not over it: nothing lands in the zone.
    expect(runSupportJob(job(standing, still, contacts)).dropped).toEqual([]);
  });
});

describe('runSupportJob: dental secondary contacts', () => {
  const model = boxes([[-20, 5, -20], [20, 9, 20]], [[-5, 20, -5], [5, 24, 5]]);
  const mask = new Uint8Array(model.indices.length / 3).fill(1);
  mask[6] = 0;
  mask[7] = 0;
  const dental: DentalPolicy = { kind: 'two-contour', profileId: REFERENCE_PROFILE, stamps: [], rim: {
    boundaryKind: 'projection-fallback', points: new Float32Array(), openingDirection: [0, -1, 0],
    centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array(),
    visibilityResolution: 0, visibilityMin: [0, 0], visibilityMax: [0, 0],
  }, region: { kind: 'proposal', allowedFaces: mask, contactFaces: mask, outerEdges: new Uint32Array(),
    outerRidgeEdges: new Uint32Array(), outerConnectorEdges: new Uint32Array(), openingEdges: new Uint32Array(),
    diagnostics: { regionFaces: [mask.reduce((a, b) => a + b, 0), 2], connectorLengths: [0, 0] } } };
  const contacts: ContactInputs = { points: [point('auto-shelf', [0, 20, 0], [0, -1, 0])], manual: [],
    deleted: [], zones: [], contactSettings: {} };

  it('returns the exact body-clearance verdict and the island report with the mesh (one generate call)', () => {
    const braceModel = boxes([[-20, 20, -20], [20, 24, 20]]);
    const manual: ContactInputs = { points: [], manual: [
      point('manual-left', [-10, 20, 0], [0, -1, 0]),
      point('manual-middle', [0, 20, 0], [0, -1, 0]),
      point('manual-right', [10, 20, 0], [0, -1, 0]),
    ], deleted: [], zones: [], contactSettings: {} };
    const built = runSupportJob({ ...job(braceModel, still, manual), dental });
    expect(built.verdict?.status).toBeDefined();
    expect(built.islands?.status).toBe('ok');
    expect(built.components.filter((component) => component.part === 'neck')).toHaveLength(3);
  });

  it('does not build automatic supports from a dental policy that cannot be reproduced from its STL', () => {
    const forged: DentalPolicy = { ...dental, region: { ...dental.region,
      contactFaces: new Uint8Array(mask.length).fill(1) } };
    const inputs: ContactInputs = { ...contacts,
      points: [point('auto-slab', [15, 5, 0], [0, -1, 0])],
      manual: [point('manual-shelf', [2, 20, 2], [0, -1, 0])] };
    const built = runSupportJob({ ...job(model, still, inputs), dental: forged });
    expect(built.dropped).toContain('auto-slab');
    expect(built.components.some((component) => component.contactId === 'auto-slab')).toBe(false);
    expect(built.components.some((component) => component.contactId === 'manual-shelf')).toBe(true);
  });

  // Which faces a secondary landing may use (strip and paint) is Rust `area_allows` / `landing_allowed`, tested there.
  it('does not trust an all-ones mask: the saved strip is recomputed, so the shelf contact is left out', () => {
    const allowed: DentalPolicy = { ...dental, region: { ...dental.region,
      contactFaces: new Uint8Array(mask.length).fill(1) } };
    expect(runSupportJob({ ...job(model, still, contacts), dental: allowed }).dropped).toEqual(['auto-shelf']);
  });
});

describe('runSupportJob: per-support settings travel with the job', () => {
  const model = boxes([[-5, 20, -5], [5, 24, 5]]);
  const contacts: ContactInputs = {
    points: [point('auto-a', [-2, 20, 0], [0, -1, 0]), point('auto-b', [2, 20, 0], [0, -1, 0])],
    manual: [], deleted: [], zones: [],
    contactSettings: { 'auto-a': { contactShape: 'SPHERE', touchDiameter: 1.4, baseDiameter: 4 } },
  };

  it('builds the same mesh from a worker copy of the job (structured clone), and the override changes it', () => {
    const sent = job(model, still, contacts);
    const built = runSupportJob(sent);
    const received = runSupportJob(structuredClone(sent));
    expect(Array.from(received.positions)).toEqual(Array.from(built.positions));
    expect(built.components.filter((component) => component.part === 'tip').map((component) => component.contactId)).toEqual(['auto-a']);
    expect(Array.from(runSupportJob(job(model, still, { ...contacts, contactSettings: {} })).positions)).not.toEqual(Array.from(built.positions));
  });
});

describe('filterDentalPlacement', () => {
  it('samples the approved two-contour faces without requiring an opening-ray hit', () => {
    const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
    const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const dental: DentalPolicy = { kind: 'two-contour', profileId: REFERENCE_PROFILE, region, stamps: [], rim: {
      boundaryKind: 'projection-fallback', points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      openingDirection: [0, 1, 0], centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1],
      visibilityMask: new Uint8Array([0]), visibilityResolution: 1, visibilityMin: [-1, -1], visibilityMax: [1, 1],
    } };
    const job: DentalPlacementJob = { mesh, orientation: still,
      settings: { overhangAngleDegrees: 45, spacing: 4, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false }, dental };
    const empty = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
    const result = filterDentalPlacement(job, empty);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.length).toBeLessThan(130);
    expect(result.points.length).toBe(region.contacts?.length);
    const forged: DentalPolicy = { ...dental, region: { ...region, allowedFaces: new Uint8Array(region.allowedFaces.length).fill(1) } };
    expect(filterDentalPlacement({ ...job, dental: forged }, empty).points).toEqual([]);
    const forgedBand: DentalPolicy = { ...dental, region: { ...region, contactFaces: new Uint8Array(region.allowedFaces.length).fill(1) } };
    expect(filterDentalPlacement({ ...job, dental: forgedBand }, empty).points).toEqual([]);
    const tuning = { setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 };
    const tuned = proposeDentalSupportRegion(mesh, tuning, REFERENCE_PROFILE);
    expect(tuned.kind).toBe('proposal');
    if (tuned.kind !== 'proposal') return;
    const tunedPolicy: DentalPolicy = { ...dental, region: tuned, tuning };
    expect(filterDentalPlacement({ ...job, dental: tunedPolicy }, empty).points).toHaveLength(tuned.contacts!.length);
    expect(filterDentalPlacement({ ...job, dental: { ...tunedPolicy, tuning: undefined } }, empty).points).toEqual([]);
  }, 60000);
  const triangle: TriangleMesh = { positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]), indices: new Uint32Array([0, 1, 2]) };
  const policy: DentalPolicy = {
    profileId: REFERENCE_PROFILE,
    rim: {
      boundaryKind: 'lower-edge-loop', points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      openingDirection: [0, 1, 0], centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1],
      visibilityMask: new Uint8Array([1, 1, 1, 1]), visibilityResolution: 2, visibilityMin: [-2, -2], visibilityMax: [2, 2],
    }, stamps: [],
  };

  it('keeps only unit-local contacts inside the approved, opening-visible dental region', () => {
    const placed = {
      points: [point('inside', [0, 0, 0], [0, 1, 0]), point('outside', [3, 0, 0], [0, 1, 0])], regions: [],
      contactPositions: new Float32Array(), contactNormals: new Float32Array(),
    };
    const result = filterDentalPlacement({ mesh: triangle, orientation: still, settings: { overhangAngleDegrees: 45, spacing: 2, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false }, dental: policy }, placed);
    expect(result.points.map((candidate) => candidate.id)).toContain('inside');
    expect(result.points.map((candidate) => candidate.id)).not.toContain('outside');
  });

  it('adds a spaced contact on an approved downward face even with no generic candidate', () => {
    const downwardTriangle: TriangleMesh = { positions: new Float32Array([0, 0, 0, 0.8, 0, 0, 0, 0, 0.8]), indices: new Uint32Array([0, 1, 2]) };
    const dentalJob: DentalPlacementJob = {
      mesh: downwardTriangle, orientation: still,
      settings: { overhangAngleDegrees: 45, spacing: 2, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false }, dental: policy,
    };
    const result = filterDentalPlacement(dentalJob, { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ source: 'interior', normal: [0, -1, 0] });
  });

  it('keeps the approval test unit-local when the dental model was rotated for placement', () => {
    const downwardTriangle: TriangleMesh = { positions: new Float32Array([0, 0, 0, 0.8, 0, 0, 0, 0, 0.8]), indices: new Uint32Array([0, 1, 2]) };
    const result = filterDentalPlacement({
      mesh: downwardTriangle, orientation: { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] },
      settings: { overhangAngleDegrees: 45, spacing: 2, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false }, dental: policy,
    }, { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.position).toEqual([expect.closeTo(0.2666666667), 0, expect.closeTo(-0.2666666667)]);
    expect(result.points[0]!.normal).toEqual([0, -1, 0]);
  });

  it('honours a later erase stamp for sampled lower surfaces', () => {
    const downwardTriangle: TriangleMesh = { positions: new Float32Array([0, 0, 0, 0.8, 0, 0, 0, 0, 0.8]), indices: new Uint32Array([0, 1, 2]) };
    const erased: DentalPolicy = { ...policy, stamps: [{ center: [0.27, 0, 0.27], radius: 1, normal: [0, -1, 0], kind: 'erase' }] };
    const result = filterDentalPlacement({
      mesh: downwardTriangle, orientation: still,
      settings: { overhangAngleDegrees: 45, spacing: 2, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false }, dental: erased,
    }, { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() });
    expect(result.points).toEqual([]);
  });
});

it('rejects an automatic primary tip not present in the recomputed dental contact samples', () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
  expect(region.kind).toBe('proposal');
  if (region.kind !== 'proposal') return;
  const source = region.contacts![0]!;
  const forged: SupportPoint = point('auto-forged',
    [source.position[0] + 5, source.position[1], source.position[2]], source.normal);
  const policy: DentalPolicy = { kind: 'two-contour', profileId: REFERENCE_PROFILE, region, stamps: [], rim: {
    boundaryKind: 'projection-fallback', points: new Float32Array(), openingDirection: [0, -1, 0],
    centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array(),
    visibilityResolution: 0, visibilityMin: [0, 0], visibilityMax: [0, 0],
  } };
  const built = runSupportJob({ ...job(mesh, still, { points: [forged], manual: [], deleted: [], zones: [], contactSettings: {} }),
    dental: policy });
  expect(built.dropped).toContain('auto-forged');
  expect(built.components.some((component) => component.contactId === 'auto-forged')).toBe(false);
}, 30000);
