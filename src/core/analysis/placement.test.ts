import { describe, expect, it } from 'vitest';
import { composeContacts, generatePlacement, hidingRemovals } from './placement';
import type { PlacementSettings, TriangleMesh } from './types';
import { GOLDEN_FIXTURES } from '../../goldens/fixtures';

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

describe('overhang angle boundary', () => {
  // The 45-degree plate of a user's test file: 8 mm up the slope, 0.75 mm thick, 20 mm long.
  function plate45(): TriangleMesh {
    const section = [[45.257, 5], [39.6, 10.657], [40.13, 11.187], [45.787, 5.53]].map(([x, y]) => [x! - 39, y!]);
    const positions: number[] = [];
    for (const z of [0, 20]) for (const [x, y] of section) positions.push(x!, y!, z);
    // Sides 0-1 (underside), 1-2 (top end), 2-3 (top), 3-0 (bottom end); then the two caps.
    const quads = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [0, 3, 2, 1], [4, 5, 6, 7]];
    return { positions: new Float32Array(positions), indices: new Uint32Array(quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!])) };
  }

  it('supports a face modelled at exactly the Overhang angle, edges included', () => {
    const result = generatePlacement(plate45(), { ...settings, spacing: 2, edgeInset: 0.15 });
    const highEdge = result.points.filter((point) => point.source === 'physical-boundary' && point.position[1] > 10.4);
    expect(result.points.filter((point) => point.source === 'interior').length).toBeGreaterThanOrEqual(5);
    expect(highEdge.length).toBeGreaterThanOrEqual(10);
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

describe('erase radius (MIXO_ManualPoints)', () => {
  const point = (x: number, id = `auto-${x * 100}_100_0`) => ({ id, regionId: 0, position: [x, 1, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], source: 'interior' as const });

  it('removes every contact within the erase radius of a removal marker, manual ones included', () => {
    const auto = [point(0), point(1), point(3)];
    const manual = [{ ...point(0.5, 'manual-a') }];
    expect(composeContacts(auto, manual, ['auto-0_100_0'], 1.5).map((p) => p.id)).toEqual(['auto-300_100_0']);
    expect(composeContacts(auto, manual, ['auto-0_100_0']).map((p) => p.id)).toEqual(['auto-100_100_0', 'auto-300_100_0', 'manual-a']);
  });
});

describe('exact deletions', () => {
  const point = (x: number, id = `auto-${Math.round(x * 100)}_100_0`) => ({ id, regionId: 0, position: [x, 1, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], source: 'interior' as const });

  it('hides exactly the deleted automatic contact, never its neighbours or manual ones', () => {
    const auto = [point(0), point(1), point(3)];
    const manual = [{ ...point(0.5, 'manual-a') }];
    expect(composeContacts(auto, manual, [], 1.5, ['auto-0_100_0'], 1).map((p) => p.id))
      .toEqual(['auto-100_100_0', 'auto-300_100_0', 'manual-a']);
  });

  it('after spots move, hides only the single nearest automatic contact within the match radius', () => {
    const moved = [point(0.3), point(0.6), point(3)];
    expect(composeContacts(moved, [], [], 0, ['auto-0_100_0'], 1).map((p) => p.id))
      .toEqual(['auto-60_100_0', 'auto-300_100_0']);
    expect(composeContacts([point(2)], [], [], 0, ['auto-0_100_0'], 1).map((p) => p.id)).toEqual(['auto-200_100_0']);
  });

  it('a contact both erased by a marker and deleted never takes a neighbour with it', () => {
    const auto = [point(0), point(0.6)];
    expect(composeContacts(auto, [], ['auto-0_100_0'], 0.5, ['auto-0_100_0'], 1).map((p) => p.id)).toEqual(['auto-60_100_0']);
  });

  it('a deleted id that matches nothing hides nothing', () => {
    const auto = [point(2), point(3)];
    expect(composeContacts(auto, [], [], 0, ['auto-0_100_0'], 1).map((p) => p.id)).toEqual(['auto-200_100_0', 'auto-300_100_0']);
  });

  it('deleted ids competing for one nearest contact each drop at most one marker', () => {
    // Both ids are nearest to 0.3: the first takes it, the second falls to the next in range.
    const moved = [point(0.3), point(0.6)];
    expect(composeContacts(moved, [], [], 0, ['auto-0_100_0', 'auto-10_100_0'], 1)).toEqual([]);
    // With nothing else in range the second id hides nothing more.
    expect(composeContacts([point(0.3), point(3)], [], [], 0, ['auto-0_100_0', 'auto-10_100_0'], 1).map((p) => p.id))
      .toEqual(['auto-300_100_0']);
  });
});

describe('placement toggles', () => {
  it('can skip downward interior sampling and edge reinforcement', () => {
    const result = generatePlacement(squareOverhang, { ...settings, includeDownward: false, reinforceEdges: false });
    expect(result.points.length).toBeGreaterThan(0);
    expect(new Set(result.points.map((point) => point.source))).toEqual(new Set(['island']));
  });
});

describe('hidingRemovals', () => {
  const point = (x: number, id = `auto-${Math.round(x * 100)}_100_0`) => ({ id, regionId: 0, position: [x, 1, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], source: 'interior' as const });
  const auto = [point(0), point(1), point(3)];
  const manual = [point(0.5, 'manual-a')];

  it('lists only the removals that hide a contact', () => {
    // auto-0 hides itself; auto-900 was never generated; manual-gone hides no manual contact.
    expect([...hidingRemovals(auto, manual, ['auto-0_100_0', 'auto-900_100_0', 'manual-gone'])]).toEqual(['auto-0_100_0']);
    // Within the erase radius a marker counts once for all it takes, a manual contact included.
    expect([...hidingRemovals(auto, manual, ['auto-0_100_0'], 1.5)]).toEqual(['auto-0_100_0']);
    // A marker whose spot moved away still counts while its radius reaches a contact.
    expect([...hidingRemovals(auto, manual, ['auto-280_100_0'], 1)]).toEqual(['auto-280_100_0']);
  });

  it('counts exact deletions and moved deletions that still find a spot, not stale ones', () => {
    expect([...hidingRemovals(auto, manual, [], 0, ['auto-100_100_0', 'auto-310_100_0', 'auto-2000_100_0'], 0.5)].sort())
      .toEqual(['auto-100_100_0', 'auto-310_100_0']);
  });

  it('hides nothing without automatic contacts', () => {
    expect(hidingRemovals([], [], ['auto-0_100_0'], 1.5, ['auto-100_100_0'], 1).size).toBe(0);
  });
});

describe('Ridge angle', () => {
  // Two overhang faces 40 degrees either side of straight down meet at an 80 degree ridge.
  const sharpFold: TriangleMesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0.84, 1, 0, 0.84, -1]),
    indices: new Uint32Array([0, 1, 2, 0, 3, 1]),
  };
  const ridgeAnchors = (degrees: number) => generatePlacement(sharpFold, { ...settings, sharpEdgeAngleDegrees: degrees })
    .points.filter((point) => point.source === 'sharp-ridge');

  it('decides which creases inside an overhang get edge anchors (strictly sharper than it)', () => {
    expect(ridgeAnchors(70).length).toBeGreaterThan(0);
    expect(ridgeAnchors(85)).toEqual([]);
  });

  const keel = GOLDEN_FIXTURES.find((fixture) => fixture.name === 'v-ridge')!.mesh;
  const keelSettings: PlacementSettings = { overhangAngleDegrees: 50, spacing: 2, edgeInset: 0.15, sharpEdgeAngleDegrees: 45, includeIslands: true, includeDownward: false };
  const keelPoints = (degrees: number, reinforceEdges: boolean) => generatePlacement(keel, { ...keelSettings, sharpEdgeAngleDegrees: degrees, reinforceEdges }).points;

  it('drives the legacy ridge points while Reinforce overhang edges is off', () => {
    const at30 = keelPoints(30, false);
    expect(at30.some((point) => point.source === 'sharp-ridge')).toBe(true);
    expect(at30).not.toEqual(keelPoints(60, false));
  });

  it('leaves the island stream alone while Reinforce overhang edges is on', () => {
    const islands = (degrees: number) => keelPoints(degrees, true).filter((point) => point.source === 'island');
    expect(islands(30)).toEqual(islands(60));
  });
});
