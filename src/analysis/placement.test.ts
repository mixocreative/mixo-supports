import { describe, expect, it } from 'vitest';
import { composeContacts, generatePlacement, isCurrentPlacement } from './placement';
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
    // Blender joins its streams without cross-class de-duplication; each stream is spaced itself.
    expect(hasPairsCloserThan(result.points.filter((point) => point.source === 'interior'), settings.spacing)).toBe(false);
    expect(hasPairsCloserThan(result.points.filter((point) => point.source === 'physical-boundary' || point.source === 'sharp-ridge'), settings.spacing * 0.9)).toBe(false);
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

  it('marks sharp shared edges and optionally emits island minima', () => {
    // Two overhang faces 40 degrees either side of straight down meet at an 80 degree ridge.
    const sharpFold: TriangleMesh = {
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 0.84, 1,
        0, 0.84, -1,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 3, 1]),
    };

    const ridges = generatePlacement(sharpFold, settings);
    const withoutIslands = generatePlacement(squareOverhang, { ...settings, includeIslands: false });
    const withIslands = generatePlacement(squareOverhang, settings);

    expect(ridges.points.some((point) => point.source === 'sharp-ridge')).toBe(true);
    expect(withoutIslands.points.some((point) => point.source === 'island')).toBe(false);
    expect(withIslands.points.some((point) => point.source === 'island')).toBe(true);
  });

  it('treats coincident coordinates with distinct vertex indices as disconnected physical boundaries', () => {
    const duplicatedVertices: TriangleMesh = {
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 0, 1,
        0, 0, 0,
        1, 0, 0,
        0, 0, 1,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };

    const result = generatePlacement(duplicatedVertices, { ...settings, includeIslands: false });
    const boundaryPoints = result.points.filter((point) => point.source === 'physical-boundary');

    expect(result.regions).toHaveLength(2);
    expect(boundaryPoints).not.toHaveLength(0);
  });
});

describe('composeContacts', () => {
  const auto = [
    { id: 'auto-0', regionId: 0, position: [0, 1, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], source: 'interior' as const },
    { id: 'auto-1', regionId: 0, position: [1, 1, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], source: 'interior' as const },
  ];
  const manual = { id: 'manual-a', regionId: -1, position: [2, 1, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], source: 'interior' as const };

  it('drops suppressed automatic contacts and appends manual contacts', () => {
    expect(composeContacts(auto.slice(0, 1), [manual], ['auto-0'])).toEqual([manual]);
    expect(composeContacts(auto, [manual], ['auto-0']).map((point) => point.id)).toEqual(['auto-1', 'manual-a']);
  });

  it('keeps suppression after a deterministic regeneration', () => {
    const first = generatePlacement(squareOverhang, settings);
    const suppressed = [first.points[0]!.id];
    const regenerated = generatePlacement(squareOverhang, settings);

    expect(composeContacts(regenerated.points, [], suppressed).some((point) => point.id === suppressed[0])).toBe(false);
    expect(composeContacts(regenerated.points, [], suppressed)).toHaveLength(first.points.length - 1);
  });
});

describe('automatic contact ids', () => {
  it('derive from position so suppressions follow the spot, not the sample order', () => {
    const coarse = generatePlacement(squareOverhang, settings);
    const dense = generatePlacement(squareOverhang, { ...settings, spacing: 0.15 });
    const shared = coarse.points.filter((point) => dense.points.some((other) => other.id === point.id));

    expect(new Set(coarse.points.map((point) => point.id)).size).toBe(coarse.points.length);
    for (const point of shared) {
      dense.points.find((other) => other.id === point.id)!.position.forEach((value, axis) => expect(value).toBeCloseTo(point.position[axis]!, 2));
    }
    expect(coarse.points[0]!.id).toMatch(/^auto--?\d+_-?\d+_-?\d+$/);
  });
});

describe('placement toggles', () => {
  it('can skip downward interior sampling and edge reinforcement', () => {
    const result = generatePlacement(squareOverhang, { ...settings, includeDownward: false, reinforceEdges: false });
    expect(result.points.length).toBeGreaterThan(0);
    expect(new Set(result.points.map((point) => point.source))).toEqual(new Set(['island']));
  });
});

describe('isCurrentPlacement', () => {
  it('accepts only the latest revision for a unit', () => {
    const latest = { 'unit-a': 3 };
    expect(isCurrentPlacement(latest, { unitId: 'unit-a', revision: 3 })).toBe(true);
    expect(isCurrentPlacement(latest, { unitId: 'unit-a', revision: 2 })).toBe(false);
    expect(isCurrentPlacement(latest, { unitId: 'unit-b', revision: 3 })).toBe(false);
  });
});
