import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyToPoint, placementMatrix, transformPositions } from '../transform';
import type { Vector } from '../vec3';
import { parseStl } from '../../../scripts/test-support/rustImport';
import { approxArray, exactArray, expectGolden } from '../../../scripts/test-support/golden';
import { regionSnapshot } from '../../../scripts/test-support/dentalSnapshots';
import { proposeDentalOrientation, rotationToDentalPose } from './dental';
import { inspectDentalCentralOpening } from './dentalContours';
import { orientDentalAligner } from './dentalOrient';
import { proposeDentalSupportRegion, retuneDentalSupportRegion, type DentalRegionProposal } from './dentalRegion';
import type { TriangleMesh } from './types';

/*
 * U6a: the Rust dental detectors against the recorded TypeScript oracle results (scripts/fixtures/golden; rule 7: IDs, masks and edge sets
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

/** Rust region against the recorded TS result (rule 7: mask, edges, faces, tip IDs exact; positions within 1e-5 mm). */
function expectSameRegion(name: string, actual: Region): void {
  expectGolden(name, regionSnapshot(actual));
}

describe('Rust dental region vs the recorded TS oracle', () => {
  const tunings = [
    { setbackMm: 0.2, stripWidthMm: 1, density: 1 },
    { setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 },
    { setbackMm: 0, stripWidthMm: 0.2, density: 0.5 },
  ];
  for (const tuning of tunings) {
    it(`matches mask, contours, tips and IDs at ${JSON.stringify(tuning)}`, () => {
      const mesh = reference();
      expectSameRegion(`dental-region-${tunings.indexOf(tuning)}`, proposal(proposeDentalSupportRegion(mesh, tuning)));
    }, 120000);
  }

  it('retunes to the recorded result and to fresh detection', () => {
    const mesh = reference();
    const base = proposal(proposeDentalSupportRegion(mesh));
    const tuning = { setbackMm: 0.35, stripWidthMm: 0.8, density: 1.25 };
    const retuned = proposal(retuneDentalSupportRegion(mesh, base, tuning));
    expectSameRegion('dental-region-retuned', retuned);
    expect(retuned).toEqual(proposal(proposeDentalSupportRegion(mesh, tuning)));
  }, 120000);

  it('reproduces the pinned reference counts', () => {
    const region = proposal(proposeDentalSupportRegion(reference()));
    expect(region.outerEdges.length / 2).toBe(2665);
    expect(region.openingEdges.length / 2).toBe(339);
    expect(region.diagnostics.regionFaces).toEqual([254344, 119612]);
  });
});

/** Rim, pose and central opening of an orientation proposal, as recorded: vectors/pose/confidence within 1e-9, rim points within 1e-4. */
function orientationSnapshots(found: ReturnType<typeof proposeDentalOrientation>, pose: Vector | undefined, opening: { kind: string; edges?: Uint32Array }) {
  expect(found.kind).toBe('proposal');
  if (found.kind !== 'proposal') throw new Error('proposal expected');
  const { rim } = found;
  return {
    tight: {
      boundaryKind: rim.boundaryKind, pointCount: rim.points.length, openingDirection: rim.openingDirection, centroid: rim.centroid,
      tangent: rim.tangent, bitangent: rim.bitangent, visibilityMask: exactArray(rim.visibilityMask, 'u8'),
      confidence: found.diagnostics.confidence, pose: pose ?? null, opening: { kind: opening.kind, edges: opening.kind === 'present' ? exactArray(opening.edges!) : null },
    },
    points: approxArray(rim.points, 5),
  };
}

describe('Rust orientation vs the recorded TS oracle', () => {
  it('matches the rim, pose and central opening of the reference and of a scrambled pose', () => {
    const mesh = reference();
    [[0, 0, 0], [0.61, -0.83, 1.17]].forEach((rotation, at) => {
      const turned = rotation.every((value) => value === 0) ? mesh
        : { positions: transformPositions(mesh.positions, placementMatrix({ position: [0, 0, 0], rotation: rotation as Vector })), indices: mesh.indices };
      const found = proposeDentalOrientation(turned);
      const actual = orientationSnapshots(found, found.kind === 'proposal' ? rotationToDentalPose(turned, found.rim) : undefined,
        found.kind === 'proposal' ? inspectDentalCentralOpening(turned, found.rim) : { kind: 'none' });
      expectGolden(`dental-orient-${at}`, actual.tight, 1e-9);
      expectGolden(`dental-orient-${at}-points`, actual.points, 1e-4);
      expect(actual.tight.pose).not.toBeNull();
    });
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
