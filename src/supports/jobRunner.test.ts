import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../core/analysis/types';
import type { ContactInputs, DentalPlacementJob, JobTransform, SupportJob } from '../core/jobs';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import type { ZoneStamp } from '../core/supports/zones';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { filterDentalPlacement, runSupportJob } from './jobRunner';

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
  const triangle: TriangleMesh = { positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]), indices: new Uint32Array([0, 1, 2]) };
  const policy: DentalPolicy = {
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
});
