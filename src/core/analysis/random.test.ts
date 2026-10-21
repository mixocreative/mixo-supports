import { describe, expect, it } from 'vitest';
import { Drand48, hashPair } from './random';

describe('hashPair (lookup3 hashword, initval 13)', () => {
  it('keeps the per-triangle seeds the scatter goldens were made with', () => {
    expect([hashPair(0, 0), hashPair(1, 0), hashPair(7, 3), hashPair(0xffffffff, 12345)])
      .toEqual([3695015161, 1267069554, 436444241, 3394342028]);
  });
});

describe('Drand48', () => {
  it('follows the POSIX srand48 LCG: seed 0 starts at 0.170828... (lrand48 / 2^31)', () => {
    expect(new Drand48(0).next()).toBeCloseTo(0.170828036, 8);
  });

  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = new Drand48(hashPair(5, 0));
    expect([a.next(), a.next(), a.next()]).toEqual([0.01130580436438322, 0.6099702902138233, 0.11806175950914621]);
    const b = new Drand48(123);
    for (let n = 0; n < 1000; n += 1) {
      const value = b.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
