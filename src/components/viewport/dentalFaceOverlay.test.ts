import { describe, expect, it } from 'vitest';
import { nodeEngine } from '../../../scripts/test-support/rustImport';
import { dentalFaceOverlay } from './dentalFaceOverlay';

describe('dental face overlay', () => {
  it('copies only approved triangles, so shared vertices cannot tint a forbidden face', () => {
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]) };
    const result = dentalFaceOverlay(mesh, new Uint8Array([1, 0]), nodeEngine);
    expect([...result.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(result.normals.length).toBe(9);
    expect(() => dentalFaceOverlay(mesh, new Uint8Array([1]), nodeEngine)).toThrow();
  });
});
