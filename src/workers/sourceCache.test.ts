import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../core/analysis/types';
import { meshBytes, SourceCache } from './sourceCache';

/** A mesh of `kb` kilobytes (positions only). */
const mesh = (kb: number): TriangleMesh => ({ positions: new Float32Array(kb * 256), indices: new Uint32Array(0) });

describe('SourceCache', () => {
  it('counts the bytes of positions and indices', () => {
    expect(meshBytes({ positions: new Float32Array(3), indices: new Uint32Array(3) })).toBe(24);
  });

  it('hands out a model only for the token it was stored with', () => {
    const cache = new SourceCache(1 << 20);
    const model = mesh(1);
    cache.put('a', 1, model);
    expect(cache.get('a', 1)).toBe(model);
    expect(cache.get('a', 2)).toBeUndefined();
    cache.put('a', 2, mesh(1));
    expect(cache.get('a', 1)).toBeUndefined();
    expect(cache.bytes).toBe(1024);
  });

  it('frees a unit on delete', () => {
    const cache = new SourceCache(1 << 20);
    cache.put('a', 1, mesh(2));
    cache.delete('a');
    expect(cache.get('a', 1)).toBeUndefined();
    expect(cache.bytes).toBe(0);
  });

  it('over the cap, evicts the least recently used models except those in use', () => {
    const cache = new SourceCache(3 * 1024);
    cache.put('a', 1, mesh(1));
    cache.put('b', 1, mesh(1));
    cache.put('c', 1, mesh(1));
    cache.get('a', 1); // a is now the most recently used
    cache.put('d', 1, mesh(1));
    expect(cache.trim(new Set(['d']))).toEqual(['b']);
    expect(cache.get('b', 1)).toBeUndefined();
    expect(cache.bytes).toBe(3 * 1024);
  });

  it('keeps a model in use even when it alone is over the cap', () => {
    const cache = new SourceCache(1024);
    cache.put('a', 1, mesh(1));
    cache.put('big', 1, mesh(4));
    expect(cache.trim(new Set(['big']))).toEqual(['a']);
    expect(cache.get('big', 1)).toBeDefined();
  });
});
