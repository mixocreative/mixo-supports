import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyToPoint, placementMatrix, transformPositions } from '../transform';
import type { Vector } from '../vec3';
import { parseStl } from '../../../scripts/test-support/rustImport';
import * as oracleDental from '../../../scripts/test-support/ts-oracle/dental/dental';
import { inspectDentalCentralOpening as oracleOpening } from '../../../scripts/test-support/ts-oracle/dental/dentalContours';
import { proposeDentalSupportRegion as oracleRegion } from '../../../scripts/test-support/ts-oracle/dental/dentalRegion';
import { proposeDentalOrientation, rotationToDentalPose } from './dental';
import { inspectDentalCentralOpening } from './dentalContours';
import { orientDentalAligner } from './dentalOrient';
import { proposeDentalSupportRegion, retuneDentalSupportRegion, type DentalRegionProposal } from './dentalRegion';
import { positionId } from '../../../scripts/test-support/ts-oracle/placement/placement';
import type { TriangleMesh } from './types';

/*
 * U6a: the Rust dental detectors against the TypeScript oracle (rule 7: IDs, masks and edge sets
 * identical, positions within 1e-5 mm), the seeded 100-pose restoration, and abstention on
 * synthetic aligners without a decidable central opening.
 */

const reference = (): TriangleMesh => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

type Region = Extract<DentalRegionProposal, { kind: 'proposal' }>;
const proposal = (region: DentalRegionProposal): Region => {
  expect(region.kind).toBe('proposal');
  return region as Region;
};

function expectSameRegion(actual: Region, expected: Region): void {
  expect(actual.allowedFaces).toEqual(expected.allowedFaces);
  expect(actual.outerEdges).toEqual(expected.outerEdges);
  expect(actual.outerRidgeEdges).toEqual(expected.outerRidgeEdges);
  expect(actual.outerConnectorEdges).toEqual(expected.outerConnectorEdges);
  expect(actual.openingEdges).toEqual(expected.openingEdges);
  expect(actual.contactFaces).toEqual(expected.contactFaces);
  expect(actual.diagnostics.regionFaces).toEqual(expected.diagnostics.regionFaces);
  actual.diagnostics.connectorLengths.forEach((length, at) => expect(length).toBeCloseTo(expected.diagnostics.connectorLengths[at]!, 6));
  expect(actual.contacts).toHaveLength(expected.contacts!.length);
  actual.contacts!.forEach((contact, at) => {
    const other = expected.contacts![at]!;
    expect(contact.face).toBe(other.face);
    expect(contact.rim).toBe(other.rim);
    // Tip IDs derive from the contact position: identical IDs, not just close points.
    expect(positionId(contact.position)).toBe(positionId(other.position));
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(contact.position[axis]! - other.position[axis]!)).toBeLessThan(1e-5);
      expect(Math.abs(contact.normal[axis]! - other.normal[axis]!)).toBeLessThan(1e-5);
    }
    expect(Math.abs(contact.distanceAlongContour - other.distanceAlongContour)).toBeLessThan(1e-5);
    expect(Math.abs(contact.distanceFromContour - other.distanceFromContour)).toBeLessThan(1e-5);
  });
}

describe('Rust dental region vs the TS oracle', () => {
  const tunings = [
    { setbackMm: 0.2, stripWidthMm: 1, density: 1 },
    { setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 },
    { setbackMm: 0, stripWidthMm: 0.2, density: 0.5 },
  ];
  for (const tuning of tunings) {
    it(`matches mask, contours, tips and IDs at ${JSON.stringify(tuning)}`, () => {
      const mesh = reference();
      expectSameRegion(proposal(proposeDentalSupportRegion(mesh, tuning)), proposal(oracleRegion(mesh, tuning)));
    }, 120000);
  }

  it('retunes to the oracle result and to fresh detection', () => {
    const mesh = reference();
    const base = proposal(proposeDentalSupportRegion(mesh));
    const tuning = { setbackMm: 0.35, stripWidthMm: 0.8, density: 1.25 };
    const retuned = proposal(retuneDentalSupportRegion(mesh, base, tuning));
    expectSameRegion(retuned, proposal(oracleRegion(mesh, tuning)));
    expect(retuned).toEqual(proposal(proposeDentalSupportRegion(mesh, tuning)));
  }, 120000);

  it('reproduces the pinned reference counts', () => {
    const region = proposal(proposeDentalSupportRegion(reference()));
    expect(region.outerEdges.length / 2).toBe(2665);
    expect(region.openingEdges.length / 2).toBe(339);
    expect(region.diagnostics.regionFaces).toEqual([254344, 119612]);
  });
});

describe('Rust orientation vs the TS oracle', () => {
  it('matches the rim, pose and central opening of the reference and of a scrambled pose', () => {
    const mesh = reference();
    for (const rotation of [[0, 0, 0], [0.61, -0.83, 1.17]] as Vector[]) {
      const turned = rotation.every((value) => value === 0) ? mesh
        : { positions: transformPositions(mesh.positions, placementMatrix({ position: [0, 0, 0], rotation })), indices: mesh.indices };
      const actual = proposeDentalOrientation(turned);
      const expected = oracleDental.proposeDentalOrientation(turned);
      expect(actual.kind).toBe('proposal');
      expect(expected.kind).toBe('proposal');
      if (actual.kind !== 'proposal' || expected.kind !== 'proposal') return;
      expect(actual.rim.boundaryKind).toBe(expected.rim.boundaryKind);
      expect(actual.rim.points).toHaveLength(expected.rim.points.length);
      actual.rim.points.forEach((value, at) => expect(Math.abs(value - expected.rim.points[at]!)).toBeLessThan(1e-4));
      for (const key of ['openingDirection', 'centroid', 'tangent', 'bitangent'] as const) {
        actual.rim[key].forEach((value, at) => expect(Math.abs(value - expected.rim[key][at]!)).toBeLessThan(1e-9));
      }
      expect(actual.rim.visibilityMask).toEqual(expected.rim.visibilityMask);
      expect(actual.diagnostics.confidence).toBeCloseTo(expected.diagnostics.confidence, 9);
      const pose = rotationToDentalPose(turned, actual.rim);
      const oraclePose = oracleDental.rotationToDentalPose(turned, expected.rim);
      expect(pose).toBeDefined();
      pose!.forEach((value, at) => expect(Math.abs(value - oraclePose![at]!)).toBeLessThan(1e-9));
      const opening = inspectDentalCentralOpening(turned, actual.rim);
      const oracleResult = oracleOpening(turned, expected.rim);
      expect(opening.kind).toBe(oracleResult.kind);
      if (opening.kind === 'present' && oracleResult.kind === 'present') expect(opening.edges).toEqual(oracleResult.edges);
    }
  }, 120000);
});

describe('100 random poses restore within 0.02 mm (seeded)', () => {
  it('proposes and restores the reference pose on every pose', () => {
    const mesh = reference();
    let state = 20261024;
    const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
    let proposals = 0;
    let maxError = 0;
    for (let trial = 0; trial < 100; trial += 1) {
      const scramble: Vector = [(random() * 2 - 1) * Math.PI, (random() * 2 - 1) * Math.PI, (random() * 2 - 1) * Math.PI];
      const turned = { positions: transformPositions(mesh.positions, placementMatrix({ position: [0, 0, 0], rotation: scramble })), indices: mesh.indices };
      const found = proposeDentalOrientation(turned);
      if (found.kind !== 'proposal') continue;
      const pose = rotationToDentalPose(turned, found.rim);
      if (!pose) continue;
      proposals += 1;
      const restored = placementMatrix({ position: [0, 0, 0], rotation: pose });
      for (let index = 0; index < mesh.positions.length / 3; index += 1013) {
        const at = index * 3;
        const point = applyToPoint(restored, turned.positions[at]!, turned.positions[at + 1]!, turned.positions[at + 2]!);
        maxError = Math.max(maxError, Math.hypot(point[0] - mesh.positions[at]!, point[1] - mesh.positions[at + 1]!, point[2] - mesh.positions[at + 2]!));
      }
    }
    expect(proposals).toBe(100);
    expect(maxError).toBeLessThan(0.02);
  }, 300000);
});

/** A closed box mesh in the rim frame: u and v span the footprint, `thickness` along the opening. */
function plate(rim: { centroid: Vector; tangent: Vector; bitangent: Vector; openingDirection: Vector }, u: [number, number], v: [number, number], thickness: number): TriangleMesh {
  const corners: Vector[] = [];
  for (const z of [-thickness / 2, thickness / 2]) for (const [a, b] of [[u[0], v[0]], [u[1], v[0]], [u[1], v[1]], [u[0], v[1]]] as [number, number][]) {
    corners.push([0, 1, 2].map((axis) => rim.centroid[axis]! + rim.tangent[axis]! * a + rim.bitangent[axis]! * b + rim.openingDirection[axis]! * z) as Vector);
  }
  return {
    positions: Float32Array.from(corners.flat()),
    indices: Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
  };
}

function withPlate(mesh: TriangleMesh, extra: TriangleMesh): TriangleMesh {
  const base = mesh.positions.length / 3;
  const positions = new Float32Array(mesh.positions.length + extra.positions.length);
  positions.set(mesh.positions);
  positions.set(extra.positions, mesh.positions.length);
  const indices = new Uint32Array(mesh.indices.length + extra.indices.length);
  indices.set(mesh.indices);
  extra.indices.forEach((index, at) => { indices[mesh.indices.length + at] = index + base; });
  return { positions, indices };
}

describe('synthetic aligners without a decidable central opening abstain', () => {
  const frame = () => {
    const mesh = reference();
    const found = proposeDentalOrientation(mesh);
    if (found.kind !== 'proposal') throw new Error('reference must orient');
    const { rim } = found;
    return { mesh, rim, min: rim.visibilityMin, max: rim.visibilityMax };
  };

  it('a covered opening is absent: Step 1 reports absent and no region is proposed', () => {
    const { mesh, rim, min, max } = frame();
    const covered = withPlate(mesh, plate(rim, [min[0] - 1, max[0] + 1], [min[1] - 1, max[1] + 1], 0.4));
    expect(orientDentalAligner(covered)).toMatchObject({ kind: 'oriented', opening: 'absent' });
    expect(proposeDentalSupportRegion(covered)).toEqual({ kind: 'inconclusive', reason: 'central-opening-absent' });
  }, 120000);

  it('a bar that splits the opening is ambiguous, never absent, and no region is proposed', () => {
    const { mesh, rim, min, max } = frame();
    const middle = (min[0] + max[0]) / 2;
    const split = withPlate(mesh, plate(rim, [middle - 1.5, middle + 1.5], [min[1] - 1, max[1] + 1], 0.4));
    const oriented = orientDentalAligner(split);
    expect(oriented).toMatchObject({ kind: 'oriented', meshOk: true });
    if (oriented.kind === 'oriented') expect(oriented.opening).not.toBe('absent');
    const region = proposeDentalSupportRegion(split);
    expect(region.kind).toBe('inconclusive');
    if (region.kind === 'inconclusive') expect(region.reason).not.toBe('central-opening-absent');
  }, 120000);

  it('a cube has no cavity and abstains', () => {
    const cube: TriangleMesh = {
      positions: Float32Array.from([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]),
      indices: Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
    };
    expect(orientDentalAligner(cube).kind).toBe('failed');
    expect(proposeDentalSupportRegion(cube).kind).toBe('inconclusive');
  });
});
