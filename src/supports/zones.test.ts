import { describe, expect, it } from 'vitest';
import { inverseTransformDirection, type ModelTransform } from '../state/transform';
import { buildVertexGrid, nextStamp, problemInZone, sameStamp, stampsAlong, stampVertices, zonedAt, zonedVertices, type ZoneStamp } from './zones';

const stamp = (kind: ZoneStamp['kind'], normal: ZoneStamp['normal'] = [0, -1, 0]): ZoneStamp => ({ center: [0, 0, 0], radius: 2, normal, kind });

describe('zonedAt', () => {
  it('is false without stamps', () => {
    expect(zonedAt([], [0, 0, 0])).toBe(false);
  });

  it('covers inside and on the boundary of a paint stamp, not outside', () => {
    const zones = [stamp('paint')];
    expect(zonedAt(zones, [1, 0, 0], [0, -1, 0])).toBe(true);
    expect(zonedAt(zones, [2, 0, 0], [0, -1, 0])).toBe(true);
    expect(zonedAt(zones, [2.01, 0, 0], [0, -1, 0])).toBe(false);
  });

  it('ignores the opposite side of a thin wall', () => {
    expect(zonedAt([stamp('paint')], [0, 0, 0], [0, 1, 0])).toBe(false);
  });

  it('skips the side test when no normal is given', () => {
    expect(zonedAt([stamp('paint')], [0, 0, 0])).toBe(true);
  });

  it('lets the last covering stamp decide', () => {
    expect(zonedAt([stamp('paint'), stamp('erase')], [0, 0, 0], [0, -1, 0])).toBe(false);
    expect(zonedAt([stamp('erase'), stamp('paint')], [0, 0, 0], [0, -1, 0])).toBe(true);
  });
});

describe('nextStamp', () => {
  it('stamps first, then once the pointer moved half a radius', () => {
    expect(nextStamp(undefined, [0, 0, 0], 2)).toBe(true);
    expect(nextStamp([0, 0, 0], [0.9, 0, 0], 2)).toBe(false);
    expect(nextStamp([0, 0, 0], [1, 0, 0], 2)).toBe(true);
  });
});

describe('zonedVertices', () => {
  // Four vertices on a line along x, normals down except the last (up: the far side of a wall).
  const positions = new Float32Array([0, 0, 0, 1.5, 0, 0, 3, 0, 0, 0.5, 0, 0]);
  const normals = new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0]);
  const at = (center: ZoneStamp['center'], kind: ZoneStamp['kind'], radius = 2): ZoneStamp => ({ center, radius, normal: [0, -1, 0], kind });

  it('marks the vertices zonedAt calls zoned', () => {
    const zones = [at([0, 0, 0], 'paint'), at([3, 0, 0], 'paint', 1), at([1.5, 0, 0], 'erase', 0.5)];
    const out = zonedVertices(zones, positions, normals);
    const expected = [0, 1, 2, 3].map((v) => (zonedAt(zones, [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!], [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!]) ? 1 : 0));
    expect([...out]).toEqual(expected);
    expect([...out]).toEqual([1, 0, 1, 0]);
  });

  it('clears a reused output array first', () => {
    const out = new Uint8Array([1, 1, 1, 1]);
    expect(zonedVertices([], positions, normals, out)).toBe(out);
    expect([...out]).toEqual([0, 0, 0, 0]);
  });
});

describe('stampVertices', () => {
  it('applying stamps one by one matches zonedVertices', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const normals = new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]);
    const zones: ZoneStamp[] = [
      { center: [0, 0, 0], radius: 1.5, normal: [0, -1, 0], kind: 'paint' },
      { center: [2, 0, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' },
      { center: [0, 0, 0], radius: 0.5, normal: [0, -1, 0], kind: 'erase' },
    ];
    const out = new Uint8Array(3);
    for (const stamp of zones) stampVertices(stamp, positions, normals, out);
    expect([...out]).toEqual([...zonedVertices(zones, positions, normals)]);
    expect([...out]).toEqual([0, 1, 1]);
  });
});

describe('sameStamp', () => {
  const a: ZoneStamp = { center: [1, 2, 3], radius: 2, normal: [0, -1, 0], kind: 'paint' };
  it('matches a copy by value', () => {
    expect(sameStamp(a, JSON.parse(JSON.stringify(a)) as ZoneStamp)).toBe(true);
  });
  it('tells apart any differing field', () => {
    expect(sameStamp(a, { ...a, center: [1, 2, 3.5] })).toBe(false);
    expect(sameStamp(a, { ...a, radius: 3 })).toBe(false);
    expect(sameStamp(a, { ...a, normal: [0, 1, 0] })).toBe(false);
    expect(sameStamp(a, { ...a, kind: 'erase' })).toBe(false);
  });
});

/** Small seeded generator (mulberry32) so the random fixtures repeat. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('buildVertexGrid', () => {
  const random = seeded(7);
  const count = 20000;
  const positions = new Float32Array(count * 3).map(() => random() * 40 - 10);
  const normals = new Float32Array(count * 3).map(() => random() * 2 - 1);
  const zones: ZoneStamp[] = Array.from({ length: 300 }, () => ({
    center: [random() * 40 - 10, random() * 40 - 10, random() * 40 - 10],
    radius: 0.5 + random() * 4,
    normal: [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1],
    kind: random() < 0.7 ? 'paint' : 'erase',
  }));

  it('lists every vertex exactly once', () => {
    const grid = buildVertexGrid(positions, 2)!;
    expect(grid.cellVertices.length).toBe(count);
    expect([...grid.cellVertices].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, v) => v));
  });

  it('gives the same layer as the brute-force pass, stamp by stamp and in full', () => {
    const grid = buildVertexGrid(positions, 2);
    const brute = zonedVertices(zones, positions, normals);
    expect([...zonedVertices(zones, positions, normals, undefined, grid)]).toEqual([...brute]);
    const out = new Uint8Array(count);
    for (const stamp of zones) stampVertices(stamp, positions, normals, out, grid);
    expect([...out]).toEqual([...brute]);
    expect(brute.some((value) => value === 1)).toBe(true);
  });

  it('caps the cell count by growing the cells, and stays exact', () => {
    const grid = buildVertexGrid(positions, 0.01, 1000)!;
    expect(grid.cellStart.length - 1).toBeLessThanOrEqual(1000);
    expect([...zonedVertices(zones, positions, normals, undefined, grid)]).toEqual([...zonedVertices(zones, positions, normals)]);
  });

  it('handles an empty vertex list and stamps outside the bounds', () => {
    const empty = buildVertexGrid(new Float32Array(0), 2);
    expect([...stampVertices(zones[0]!, new Float32Array(0), new Float32Array(0), new Uint8Array(0), empty)]).toEqual([]);
    const grid = buildVertexGrid(positions, 2)!;
    const far: ZoneStamp = { center: [1000, 1000, 1000], radius: 2, normal: [0, 1, 0], kind: 'paint' };
    expect(stampVertices(far, positions, normals, new Uint8Array(count), grid).every((value) => value === 0)).toBe(true);
  });

  it('builds no grid for non-finite coordinates or a cell size of zero or less (callers visit every vertex)', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const broken = positions.slice();
      broken[301] = bad;
      expect(buildVertexGrid(broken, 2)).toBeUndefined();
    }
    for (const size of [0, -1, NaN, Infinity]) expect(buildVertexGrid(positions, size)).toBeUndefined();
    const brute = zonedVertices(zones, positions, normals);
    expect([...zonedVertices(zones, positions, normals, undefined, buildVertexGrid(positions, 0))]).toEqual([...brute]);
  });
});

describe('stampsAlong', () => {
  it('fills a gap wider than the radius with centers every half radius', () => {
    expect(stampsAlong([0, 0, 0], [5, 0, 0], 2)).toEqual([[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]]);
  });

  it('keeps every step at most half a radius', () => {
    const centers = [[0, 0, 0], ...stampsAlong([0, 0, 0], [0, 7, 0], 2), [0, 7, 0]];
    for (let i = 1; i < centers.length; i++) expect(Math.abs(centers[i]![1]! - centers[i - 1]![1]!)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('adds nothing within one radius', () => {
    expect(stampsAlong([0, 0, 0], [2, 0, 0], 2)).toEqual([]);
    expect(stampsAlong([0, 0, 0], [1, 0, 0], 2)).toEqual([]);
  });

  it('adds nothing across a jump of more than six radii', () => {
    expect(stampsAlong([0, 0, 0], [12.5, 0, 0], 2)).toEqual([]);
    expect(stampsAlong([0, 0, 0], [12, 0, 0], 2).length).toBe(11);
  });
});

describe('problemInZone', () => {
  // The object stands rotated; checks report spots facing down in plate space.
  const orientation: ModelTransform = { position: [0, 0, 0], rotation: [Math.PI / 2, 0, Math.PI / 4] };
  const downLocal = inverseTransformDirection(orientation, [0, -1, 0]);
  const upLocal = inverseTransformDirection(orientation, [0, 1, 0]);

  it('is true for a spot under a zone painted on the underside', () => {
    const zones: ZoneStamp[] = [{ center: [3, 4, 5], radius: 2, normal: downLocal, kind: 'paint' }];
    expect(problemInZone(zones, [3.5, 4, 5], downLocal)).toBe(true);
  });

  it('is false for a spot on the far side of a thin floor painted on top', () => {
    const floorTop: ZoneStamp[] = [{ center: [3, 4, 5], radius: 2, normal: upLocal, kind: 'paint' }];
    const underside = [3 + downLocal[0] * 0.5, 4 + downLocal[1] * 0.5, 5 + downLocal[2] * 0.5] as ZoneStamp['center'];
    expect(problemInZone(floorTop, underside, downLocal)).toBe(false);
  });
});
