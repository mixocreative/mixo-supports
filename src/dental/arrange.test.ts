import { describe, expect, it } from 'vitest';
import { arrangeFootprints, type Footprint } from './arrange';

const box = (id: string, w: number, d: number, x = 0, z = 0): Footprint => ({ id, minX: x, maxX: x + w, minZ: z, maxZ: z + d });
const moved = (item: Footprint, move: { dx: number; dz: number }) => ({ ...item, minX: item.minX + move.dx, maxX: item.maxX + move.dx, minZ: item.minZ + move.dz, maxZ: item.maxZ + move.dz });
const overlap = (a: Footprint, b: Footprint) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

describe('arrangeFootprints', () => {
  it('lays the footprints in a row, left to right, with the gap between them and none overlapping', () => {
    const items = [box('a', 60, 50, 10, 10), box('b', 70, 40, 5, 5), box('c', 55, 45, -30, 0)];
    const moves = arrangeFootprints(items, { gap: 6, rowWidth: 1000 });
    const placed = items.map((item) => moved(item, moves.get(item.id)!));
    for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) expect(overlap(placed[i]!, placed[j]!)).toBe(false);
    expect(placed[1]!.minX - placed[0]!.maxX).toBeCloseTo(6);
    expect(placed[2]!.minX - placed[1]!.maxX).toBeCloseTo(6);
    // Centred on the plate origin.
    expect((placed[0]!.minX + placed[2]!.maxX) / 2).toBeCloseTo(0);
  });
  it('wraps to a new row beyond the row width, still without overlap', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id, index) => box(id, 90, 60, index * 3, index));
    const moves = arrangeFootprints(items, { gap: 6, rowWidth: 200 });
    const placed = items.map((item) => moved(item, moves.get(item.id)!));
    for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) expect(overlap(placed[i]!, placed[j]!)).toBe(false);
    expect(new Set(placed.map((item) => item.minZ.toFixed(3))).size).toBeGreaterThan(1);
  });
  it('can start to the right of objects already on the plate', () => {
    const moves = arrangeFootprints([box('a', 40, 40, 3, 3)], { startX: 100 });
    expect(moved(box('a', 40, 40, 3, 3), moves.get('a')!).minX).toBeCloseTo(100);
  });
});
