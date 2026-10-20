import { describe, expect, it } from 'vitest';
import { generatePlacement } from './placement';
import type { PlacementSettings, TriangleMesh } from './types';

const squareOverhang: TriangleMesh = {
  positions: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 0, 1,
    1, 0, 1,
  ]),
  indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
};

const settings: PlacementSettings = {
  overhangAngleDegrees: 45,
  spacing: 0.3,
  edgeInset: 0.08,
  sharpEdgeAngleDegrees: 20,
  includeIslands: true,
};

function hasPairsCloserThan(points: readonly { position: readonly [number, number, number] }[], distance: number): boolean {
  return points.some((point, index) => points.slice(index + 1).some((other) =>
    Math.hypot(
      point.position[0] - other.position[0],
      point.position[1] - other.position[1],
      point.position[2] - other.position[2],
    ) < distance,
  ));
}

describe('generatePlacement', () => {
  it('is deterministic, reinforces physical boundaries, and keeps candidates spaced across a region', () => {
    const result = generatePlacement(squareOverhang, settings);

    expect(result).toEqual(generatePlacement(squareOverhang, settings));
    expect(result.points.some((point) => point.source === 'physical-boundary')).toBe(true);
    expect(hasPairsCloserThan(result.points, settings.spacing * 0.35)).toBe(false);
  });

  it('insets physical-boundary contacts onto their downward face', () => {
    const result = generatePlacement(squareOverhang, settings);
    const boundaryPoints = result.points.filter((point) => point.source === 'physical-boundary');

    expect(boundaryPoints.length).toBeGreaterThan(0);
    for (const point of boundaryPoints) {
      expect(point.position[0]).toBeGreaterThan(0);
      expect(point.position[0]).toBeLessThan(1);
      expect(point.position[2]).toBeGreaterThan(0);
      expect(point.position[2]).toBeLessThan(1);
      expect(point.normal).toEqual([0, -1, 0]);
    }
  });

  it('marks sharp shared edges and optionally emits the lowest island contact', () => {
    const sharpFold: TriangleMesh = {
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 0, 1,
        0.5, -0.5, 1,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 1, 3]),
    };

    const ridges = generatePlacement(sharpFold, settings);
    const withoutIslands = generatePlacement(squareOverhang, { ...settings, includeIslands: false });
    const withIslands = generatePlacement(squareOverhang, settings);

    expect(ridges.points.some((point) => point.source === 'sharp-ridge')).toBe(true);
    expect(withoutIslands.points.some((point) => point.source === 'island')).toBe(false);
    expect(withIslands.points.some((point) => point.source === 'island')).toBe(true);
  });
});
