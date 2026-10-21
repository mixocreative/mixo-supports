import { describe, expect, it } from 'vitest';
import { mergeByDistance } from './mergeByDistance';

describe('mergeByDistance', () => {
  it('merges points exactly the range apart', () => {
    expect(mergeByDistance([[0, 0, 0], [2, 0, 0]], 2)).toEqual([[0, 1]]);
  });

  it('claims in index order without chaining', () => {
    // 0 claims 1; 2 is in range of 1 only, so it stays on its own.
    expect(mergeByDistance([[0, 0, 0], [1.5, 0, 0], [3, 0, 0]], 2)).toEqual([[0, 1], [2]]);
  });

  it('orders clusters by their seed and members by index', () => {
    expect(mergeByDistance([[10, 0, 0], [0, 0, 0], [1, 0, 0]], 2)).toEqual([[0], [1, 2]]);
    expect(mergeByDistance([[1, 0, 0], [5, 0, 0], [0, 0, 0]], 2)).toEqual([[0, 2], [1]]);
  });

  it('agrees with an all-pairs scan', () => {
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const points = Array.from({ length: 400 }, () => [Math.floor(random() * 20) / 2, Math.floor(random() * 20) / 2, 0] as [number, number, number]);
    const f = Math.fround;
    const target = new Array<number>(points.length).fill(-1);
    for (let s = 0; s < points.length; s += 1) {
      if (target[s] !== -1) continue;
      let claimed = 0;
      points.forEach((p, o) => {
        const d = [0, 1, 2].map((axis) => f(f(points[s]![axis]!) - f(p[axis]!)));
        if (o !== s && target[o] === -1 && f(f(f(d[0]! * d[0]!) + f(d[1]! * d[1]!)) + f(d[2]! * d[2]!)) <= 4) { target[o] = s; claimed += 1; }
      });
      if (claimed > 0) target[s] = s;
    }
    const groups = new Map<number, number[]>();
    target.forEach((t, i) => { const k = t === -1 ? i : t; groups.set(k, [...(groups.get(k) ?? []), i]); });
    expect(mergeByDistance(points, 2)).toEqual([...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list));
  });
});
