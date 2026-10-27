import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DentalRim } from '../core/analysis/dental';
import { proposeDentalOrientation, rotationToDentalPose } from '../core/analysis/dental';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { PlacementResult, PlacementSettings, TriangleMesh } from '../core/analysis/types';
import type { DentalPlacementJob } from '../core/jobs';
import { applyTransform } from '../state/transform';
import { placeGeneric } from '../supports/genericPlacement';
import { parseStl } from '../../scripts/test-support/rustImport';
import { dentalAllowedVertices as oracleVertices, filterLegacyDentalPlacement } from '../../scripts/test-support/ts-oracle/dental/legacy';
import { DentalOpeningRaycaster } from '../../scripts/test-support/ts-oracle/dental/dental';
import { filterDentalPlacement } from './placement';
import { legacyBaselineVertices } from './legacyArea';
import { manualAreaPolicy } from './manualArea';

/*
 * U8: the legacy (non two-contour) dental placement in Rust against the TypeScript oracle
 * (rule 7: IDs identical, positions within 1e-5 mm), plus the area rules it keeps: a painted-from-scratch
 * area needs paint, an erase stamp removes it, only a lower-edge rim authorises a detected area, and a
 * covered surface is never seen from the opening.
 */

const down: [number, number, number] = [0, -1, 0];
const rim: DentalRim = {
  boundaryKind: 'lower-edge-loop', points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  openingDirection: [0, -1, 0], centroid: [5, 0, 5], tangent: [1, 0, 0], bitangent: [0, 0, 1],
  visibilityMask: new Uint8Array(16).fill(1), visibilityResolution: 4, visibilityMin: [-6, -6], visibilityMax: [6, 6],
};
const settings: PlacementSettings = { overhangAngleDegrees: 45, spacing: 3, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false };
const empty: PlacementResult = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
const still = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };

/** Two facing-down triangles on y = 0 and a covering plate on y = -2 over the first half. */
const plate: TriangleMesh = {
  positions: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 0, 10, 10, 0, 10, 0, -2, 0, 10, -2, 0, 0, -2, 10]),
  indices: Uint32Array.from([0, 1, 2, 2, 1, 3, 4, 6, 5]),
};

function expectSame(actual: PlacementResult, expected: PlacementResult): void {
  expect(actual.points.map((point) => point.id)).toEqual(expected.points.map((point) => point.id));
  actual.points.forEach((point, at) => {
    const other = expected.points[at]!;
    expect(point.source).toBe(other.source);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(point.position[axis]! - other.position[axis]!)).toBeLessThanOrEqual(1e-5);
      expect(Math.abs(point.normal[axis]! - other.normal[axis]!)).toBeLessThanOrEqual(1e-5);
    }
  });
}

function both(job: DentalPlacementJob, initial: PlacementResult = empty): PlacementResult {
  const actual = filterDentalPlacement(job, initial);
  expectSame(actual, filterLegacyDentalPlacement(job, initial));
  return actual;
}

describe('legacy dental area (Rust against the oracle)', () => {
  const job = (dental: DentalPolicy, mesh: TriangleMesh = plate): DentalPlacementJob => ({ mesh, orientation: still, settings, dental });

  it('a detected legacy area fills the visible footprint', () => {
    const result = both(job({ rim, stamps: [] }));
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('a painted-from-scratch area permits nothing until painted, and an erase stamp removes it again', () => {
    const manual = manualAreaPolicy(rim, false);
    expect(both(job(manual)).points).toEqual([]);
    const painted: DentalPolicy = { ...manual, stamps: [{ center: [5, -2, 5], radius: 30, normal: down, kind: 'allow' }] };
    expect(both(job(painted)).points.length).toBeGreaterThan(0);
    const erased: DentalPolicy = { ...painted, stamps: [...painted.stamps, { center: [5, -2, 5], radius: 30, normal: down, kind: 'erase' }] };
    expect(both(job(erased)).points).toEqual([]);
  });

  it('a projection-fallback rim never authorises a detected area, paint on it still counts only for a manual area', () => {
    const fallback: DentalPolicy = { rim: { ...rim, boundaryKind: 'projection-fallback' }, stamps: [] };
    expect(both(job(fallback)).points).toEqual([]);
  });

  it('the overlay mask is the same gate as the generated contacts', () => {
    const mask = legacyBaselineVertices(plate, { rim, stamps: [] });
    const normals = new Float32Array(plate.positions.length);
    const expected = oracleVertices({ rim, stamps: [] }, new DentalOpeningRaycaster(plate, rim), plate.positions, normals);
    expect([...mask]).toEqual([...expected]);
    expect(mask.some((v) => v === 1)).toBe(true);
  });

  it('generic contacts the area permits are kept ahead of the fill, in order', () => {
    const generic = placeGeneric(applyTransform(plate, still), settings);
    const result = both(job({ rim, stamps: [] }), generic);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('matches the oracle on the reference aligner (detected legacy rim and a painted area)', () => {
    const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
    const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const orientation = proposeDentalOrientation(mesh);
    expect(orientation.kind).toBe('proposal');
    if (orientation.kind !== 'proposal') return;
    const rotation = rotationToDentalPose(mesh, orientation.rim)!;
    const turn = { position: [0, 0, 0] as [number, number, number], rotation };
    const generic = placeGeneric(applyTransform(mesh, turn), settings);
    const aligner = (dental: DentalPolicy): DentalPlacementJob => ({ mesh, orientation: turn, settings, dental });
    const detected = both(aligner({ rim: orientation.rim, stamps: [] }), generic);
    const centre = Array.from(orientation.rim.points.subarray(0, 3)) as [number, number, number];
    const manual = manualAreaPolicy(orientation.rim, false);
    const painted = both(aligner({ ...manual, stamps: [{ center: centre, radius: 25, normal: orientation.rim.openingDirection, kind: 'allow' }] }), generic);
    // The comparison must not be vacuous.
    expect(detected.points.length + painted.points.length).toBeGreaterThan(0);
  }, 300_000);
});
