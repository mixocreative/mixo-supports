import { describe, expect, it } from 'vitest';
import { TorusKnotGeometry } from 'three';
import { buffers, prepare } from './prepareImport';
import { decimate } from '../../scripts/test-support/legacyDecimate';
import { centreInPlace, geometryToMesh } from '../../scripts/test-support/rustImport';

describe('import worker preparation', () => {
  it('a full-tier mesh gets no display copy, and its buffers transfer once each', () => {
    const imported = geometryToMesh(new TorusKnotGeometry(10, 3, 400, 40)); // 32,000 triangles
    const prepared = prepare({ name: 'knot', mesh: imported }, 'web', () => {}, centreInPlace, decimate);
    expect(prepared.display).toBeUndefined();
    expect(buffers([prepared])).toEqual([prepared.mesh.positions.buffer, prepared.mesh.indices.buffer]);
  });
});
