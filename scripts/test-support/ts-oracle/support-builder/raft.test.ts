import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import { raftOutline } from './raft';

/** Axis-aligned boxes in one mesh (web Y up), given as [x0, z0, x1, z1] footprints 2 mm tall. */
function boxes(footprints: [number, number, number, number][], y = 5): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x0, z0, x1, z1] of footprints) {
    const base = positions.length / 3;
    for (const yy of [y, y + 2]) for (const zz of [z0, z1]) for (const xx of [x0, x1]) positions.push(xx, yy, zz);
    const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const [a, b, c, d] of quads) indices.push(base + a!, base + b!, base + c!, base + a!, base + c!, base + d!);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe('raftOutline', () => {
  it('gives every part set apart on the plate its own outline', () => {
    const outline = raftOutline(boxes([[0, 0, 30, 6], [40, 0, 50, 6], [60, 0, 64, 6]]), 3, 32);
    expect(outline.others).toHaveLength(2);
    const xs = (loop: { polygon: [number, number][] }) => loop.polygon.map(([x]) => x);
    expect(Math.max(...xs(outline))).toBeLessThan(35);
    expect(outline.others.map((loop) => Math.min(...xs(loop))).sort((a, b) => a - b)).toEqual([expect.closeTo(37, 0), expect.closeTo(57, 0)]);
  });

  it('traces a narrow part at its own resolution, not the whole plate', () => {
    // At 16 voxels over the whole 130 mm plate a voxel is ~8 mm, wider than the 1 mm part.
    const outline = raftOutline(boxes([[0, 0, 30, 80], [129, 0, 130, 80]]), 3, 16);
    expect(outline.others).toHaveLength(1);
    const xs = outline.others[0]!.polygon.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThan(125.5);
    expect(Math.min(...xs)).toBeLessThan(126.5);
    expect(Math.max(...xs)).toBeGreaterThan(132.5);
    expect(Math.max(...xs)).toBeLessThan(133.5);
  });

  it('covers every part wherever it lands on the trace grid', () => {
    // A wide part and a 0.75 mm wall 80 mm long, slid across the grid in uneven steps.
    for (let shift = 0; shift < 9; shift += 0.73) {
      const outline = raftOutline(boxes([[shift, 0, shift + 8, 80], [shift + 120, 0, shift + 120.75, 80]]), 3, 16);
      const loops = [outline, ...outline.others];
      expect(loops).toHaveLength(2);
      const wall = loops.find((loop) => loop.polygon[0]![0] > shift + 60)!;
      const xs = wall.polygon.map(([x]) => x);
      // Expand Width 3 on each side of the wall, within a voxel.
      expect(Math.min(...xs)).toBeGreaterThan(shift + 116.2);
      expect(Math.min(...xs)).toBeLessThan(shift + 118);
      expect(Math.max(...xs)).toBeGreaterThan(shift + 122.7);
      expect(Math.max(...xs)).toBeLessThan(shift + 124.6);
    }
  });

  it('keeps a single part to one outline', () => {
    expect(raftOutline(boxes([[0, 0, 30, 6]]), 3, 32).others).toHaveLength(0);
  });
});
