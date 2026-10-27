import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../src/core/analysis/types';
import { decimate } from './legacyDecimate';
import { meshBounds } from '../../src/core/supports/meshQuery';

/** A UV sphere of radius 10 with `rings` x `segments` quads (two triangles each). */
function sphere(rings: number, segments: number): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rings; r += 1) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s += 1) {
      const theta = (s / segments) * 2 * Math.PI;
      positions.push(10 * Math.sin(phi) * Math.cos(theta), 10 * Math.cos(phi), 10 * Math.sin(phi) * Math.sin(theta));
    }
  }
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe('decimate (display copy of a heavy mesh)', () => {
  const big = sphere(200, 400); // 160,000 triangles

  it('returns a small enough mesh unchanged', () => {
    expect(decimate(big, 200_000)).toBe(big);
  });

  it('gets under the triangle target, keeps the shape and drops degenerate triangles', () => {
    const small = decimate(big, 10_000);
    const triangles = small.indices.length / 3;
    expect(triangles).toBeLessThanOrEqual(10_000);
    expect(triangles).toBeGreaterThan(2_000);
    const [before, after] = [meshBounds(big), meshBounds(small)];
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(after.min[axis]! - before.min[axis]!)).toBeLessThan(1);
      expect(Math.abs(after.max[axis]! - before.max[axis]!)).toBeLessThan(1);
    }
    for (let t = 0; t < small.indices.length; t += 3) {
      const [a, b, c] = [small.indices[t]!, small.indices[t + 1]!, small.indices[t + 2]!];
      expect(a !== b && b !== c && a !== c).toBe(true);
    }
    expect(Math.max(...small.indices)).toBeLessThan(small.positions.length / 3);
  });

  it('is deterministic', () => {
    const [a, b] = [decimate(big, 10_000), decimate(big, 10_000)];
    expect(a.positions).toEqual(b.positions);
    expect(a.indices).toEqual(b.indices);
  });
});
