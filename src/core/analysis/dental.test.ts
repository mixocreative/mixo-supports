import { describe, expect, it } from 'vitest';
import { applyToDirection, applyToPoint, placementMatrix } from '../transform';
import { dot, type Vector } from '../vec3';
import { proposeDentalOrientation, rotationToDentalPose } from './dental';
import { rimContainsPoint, rotationToPlateDown } from '../../../scripts/test-support/dentalExpect';
import type { TriangleMesh } from './types';

describe('proposeDentalOrientation', () => {
  it('recovers a watertight cavity opening after an arbitrary rotation', () => {
    const fixture = watertightCup();
    const scramble: Vector = [0.61, -0.83, 1.17];
    const mesh = rotateMesh(fixture, scramble);
    const expectedOpening = applyToDirection(placementMatrix({ position: [0, 0, 0], rotation: scramble }), 0, 1, 0);

    const result = proposeDentalOrientation(mesh);

    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    expect(dot(result.rim.openingDirection, expectedOpening)).toBeGreaterThan(0.99);
    expect(result.rim.points.length).toBeGreaterThanOrEqual(24);
    expect(result.rim.points.length % 3).toBe(0);
    expect(result.rim.visibilityMask.some(Boolean)).toBe(true);
    expect(result.rim.visibilityMask.length).toBe(result.rim.visibilityResolution ** 2);
    const rotation = placementMatrix({ position: [0, 0, 0], rotation: scramble });
    expect(rimContainsPoint(result.rim, applyToPoint(rotation, 0, -4, 0))).toBe(true);
    expect(rimContainsPoint(result.rim, applyToPoint(rotation, 12, -4, 0))).toBe(false);

    const plateDown = rotationToPlateDown(result.rim.openingDirection);
    const mapped = applyToDirection(placementMatrix({ position: [0, 0, 0], rotation: plateDown }), ...result.rim.openingDirection);
    expect(mapped[0]).toBeCloseTo(0, 6);
    expect(mapped[1]).toBeCloseTo(-1, 6);
    expect(mapped[2]).toBeCloseTo(0, 6);
  });

  it('refuses a cube and malformed geometry instead of inventing a dental bottom', () => {
    expect(proposeDentalOrientation(cube()).kind).toBe('inconclusive');
    expect(proposeDentalOrientation({
      positions: new Float32Array([0, 0, 0, Number.NaN, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    })).toMatchObject({ kind: 'inconclusive', reason: 'invalid-mesh' });
  });

  it('is deterministic and keeps the rim in unit-local coordinates', () => {
    const mesh = rotateMesh(watertightCup(), [0.2, 0.9, -0.7]);
    const first = proposeDentalOrientation(mesh);
    const second = proposeDentalOrientation(mesh);
    expect(second).toEqual(first);
  });

  it('refuses an invalid orientation direction', () => {
    expect(() => rotationToPlateDown([0, 0, 0])).toThrow(RangeError);
  });

  it('does not invent a signed front for a rotationally symmetric cavity', () => {
    const mesh = watertightCup();
    const result = proposeDentalOrientation(mesh);
    expect(result.kind).toBe('proposal');
    if (result.kind === 'proposal') expect(rotationToDentalPose(mesh, result.rim)).toBeUndefined();
  });
});

/** A closed thick cup. Its rim is bridged, so it has no literal boundary edges. */
function watertightCup(): TriangleMesh {
  const segments = 16;
  const outerRadius = 10;
  const innerRadius = 8;
  const bottom = -4;
  const rim = 4;
  const positions: number[] = [0, bottom, 0];
  for (const y of [bottom, rim]) for (const radius of [outerRadius, innerRadius]) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment * Math.PI * 2 / segments;
      positions.push(radius * Math.cos(angle), y, radius * Math.sin(angle));
    }
  }
  const index = (level: number, ring: number, segment: number) => 1 + (level * 2 + ring) * segments + (segment + segments) % segments;
  const indices: number[] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    // Outside, rim bridge, inside, and the annular floor form one closed shell.
    quad(indices, index(0, 0, segment), index(0, 0, next), index(1, 0, next), index(1, 0, segment));
    quad(indices, index(1, 0, segment), index(1, 0, next), index(1, 1, next), index(1, 1, segment));
    quad(indices, index(1, 1, segment), index(1, 1, next), index(0, 1, next), index(0, 1, segment));
    quad(indices, index(0, 1, segment), index(0, 1, next), index(0, 0, next), index(0, 0, segment));
    indices.push(0, index(0, 1, next), index(0, 1, segment));
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function quad(out: number[], a: number, b: number, c: number, d: number): void {
  out.push(a, b, c, a, c, d);
}

function cube(): TriangleMesh {
  const positions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]);
  return { positions, indices };
}

function rotateMesh(mesh: TriangleMesh, rotation: Vector): TriangleMesh {
  const matrix = placementMatrix({ position: [0, 0, 0], rotation });
  const positions = new Float32Array(mesh.positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = mesh.positions[offset]!;
    const y = mesh.positions[offset + 1]!;
    const z = mesh.positions[offset + 2]!;
    const direction = applyToDirection(matrix, x, y, z);
    const length = Math.hypot(x, y, z);
    positions[offset] = direction[0] * length;
    positions[offset + 1] = direction[1] * length;
    positions[offset + 2] = direction[2] * length;
  }
  return { positions, indices: mesh.indices.slice() };
}
