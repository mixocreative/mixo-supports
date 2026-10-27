import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nodeEngine, parseStl } from '../../scripts/test-support/rustImport';
import { buildPickIndexData, pickIndexFor, setPickIndex } from './pickIndexes';
import { buffers } from './prepareImport';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engine = nodeEngine as unknown as Record<string, any>;
const bytes = readFileSync('scripts/fixtures/knot.stl');
const knot = parseStl(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'knot');

describe('pick index built in the import worker', () => {
  const index = buildPickIndexData(engine as never, knot);
  const lazy = new engine.GeometrySession(0x10000000);
  const lazyHandle = lazy.load_mesh(knot.positions, knot.indices);
  const loaded = new engine.GeometrySession(0x10000000);
  const loadedHandle = loaded.load_mesh_indexed(knot.positions, knot.indices, index.bounds, index.links, index.order);

  it('a session that loads it picks exactly like one that builds its own', () => {
    const rays: number[] = [];
    for (let k = 0; k < 400; k += 1) {
      const a = k * 0.7;
      rays.push(Math.cos(a) * 40, 60, Math.sin(a) * 40, -Math.cos(a) * 0.4, -1, -Math.sin(a) * 0.4);
    }
    for (const side of [0, 1, 2]) {
      const norm = Float64Array.from(rays);
      for (let r = 0; r < norm.length; r += 6) {
        const length = Math.hypot(norm[r + 3]!, norm[r + 4]!, norm[r + 5]!);
        for (let c = 3; c < 6; c += 1) norm[r + c] = norm[r + c]! / length;
      }
      const expected = Array.from(lazy.pick(lazyHandle, norm, 0, Infinity, side) as Float64Array);
      expect(Array.from(loaded.pick(loadedHandle, norm, 0, Infinity, side) as Float64Array)).toEqual(expected);
      expect(expected.some((v, k) => k % 5 === 0 && v >= 0)).toBe(true);
    }
  });

  it('refuses an index that does not belong to the mesh', () => {
    const other = parseStl(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'other');
    other.indices = other.indices.slice(0, other.indices.length - 3);
    expect(() => new engine.GeometrySession(0x10000000).load_mesh_indexed(other.positions, other.indices, index.bounds, index.links, index.order)).toThrow();
    const damaged = Uint32Array.from(index.order);
    damaged[1] = damaged[0]!;
    expect(() => new engine.GeometrySession(0x10000000).load_mesh_indexed(knot.positions, knot.indices, index.bounds, index.links, damaged)).toThrow();
  });

  it('is filed under the drawn positions and travels with the prepared mesh buffers', () => {
    setPickIndex(knot.positions, index);
    expect(pickIndexFor(knot.positions)).toBe(index);
    expect(pickIndexFor(new Float32Array(3))).toBeUndefined();
    expect(buffers([{ name: 'knot', mesh: knot, pickIndex: index }])).toEqual([knot.positions.buffer, knot.indices.buffer, index.bounds.buffer, index.links.buffer, index.order.buffer]);
  });
});
