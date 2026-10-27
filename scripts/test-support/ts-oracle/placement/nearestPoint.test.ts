import { describe, expect, it } from 'vitest';
import { NearestPoint } from './nearestPoint';

type Vector = [number, number, number];

describe('NearestPoint', () => {
  it('returns -1 for an empty set', () => {
    expect(new NearestPoint([]).nearest([0, 0, 0])).toBe(-1);
  });

  it('gives exact distance ties to the lowest index', () => {
    const points: Vector[] = [[5, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0]];
    expect(new NearestPoint(points).nearest([0, 0, 0])).toBe(1);
  });

  it('reports the closest point of the 2^-23 box around the winner', () => {
    const hit = new NearestPoint([[1, 2, 3]]).nearestHit([0, 2, 3]);
    expect(hit.index).toBe(0);
    expect(hit.co).toEqual([Math.fround(1 - 2 ** -23), 2, 3]);
  });

  it('agrees with a brute-force scan (lowest index on ties) on many points', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // A coarse grid makes plenty of exact ties.
    const points: Vector[] = Array.from({ length: 600 }, () => [Math.floor(random() * 10), Math.floor(random() * 10), Math.floor(random() * 4)]);
    const index = new NearestPoint(points);
    const f = Math.fround;
    const boxDistance = (q: Vector, p: Vector) => {
      const d = [0, 1, 2].map((axis) => f(f(q[axis]!) - Math.min(Math.max(f(q[axis]!), f(p[axis]! - 2 ** -23)), f(p[axis]! + 2 ** -23))));
      return f(f(f(d[0]! * d[0]!) + f(d[1]! * d[1]!)) + f(d[2]! * d[2]!));
    };
    for (let n = 0; n < 300; n += 1) {
      const q: Vector = [random() * 10, random() * 10, random() * 4];
      if (n % 3 === 0) q[0] = Math.round(q[0] * 2) / 2;
      let best = -1;
      let bestDistance = Infinity;
      points.forEach((p, i) => { const d = boxDistance(q, p); if (d < bestDistance) { bestDistance = d; best = i; } });
      expect(index.nearest(q)).toBe(best);
    }
  });
});
