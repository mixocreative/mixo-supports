import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import { topologyBirths } from './topologyBirths';

const mesh = (positions: number[], indices: number[]): TriangleMesh => ({
  positions: new Float32Array(positions), indices: new Uint32Array(indices),
});

describe('topologyBirths', () => {
  it('counts one equal-height bottom plateau as one birth', () => {
    const tetra = mesh([-1, 5, -1, 1, 5, -1, 0, 5, 1, 0, 7, 0],
      [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0]);
    expect(topologyBirths(tetra)).toEqual({ status: 'ok', births: [
      { height: 5, vertex: 0, plateauVertices: [0, 1, 2] },
    ] });
  });

  it('finds a later disconnected birth but not a vertex sloping upward from an existing region', () => {
    const twoTetrahedra = mesh([
      -5, 0, 0, -4, 0, 0, -4.5, 0, 1, -4.5, 2, 0,
      4, 5, 0, 5, 5, 0, 4.5, 5, 1, 4.5, 7, 0,
    ], [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0,
      4, 5, 6, 4, 7, 5, 5, 7, 6, 6, 7, 4]);
    expect(topologyBirths(twoTetrahedra)).toEqual({ status: 'ok', births: [
      { height: 0, vertex: 0, plateauVertices: [0, 1, 2] },
      { height: 5, vertex: 4, plateauVertices: [4, 5, 6] },
    ] });
  });

  it('reports two minima before their regions join through a higher saddle', () => {
    const arch = mesh([-2, 1, 0, 2, 1, 0, 0, 3, 0, -2, 4, 1, 2, 4, 1],
      [0, 2, 3, 1, 4, 2, 2, 4, 3]);
    expect(topologyBirths(arch)).toEqual({ status: 'ok', births: [
      { height: 1, vertex: 0, plateauVertices: [0] },
      { height: 1, vertex: 1, plateauVertices: [1] },
    ] });
  });

  it('refuses non-finite or malformed mesh input instead of reporting a safe empty result', () => {
    expect(topologyBirths(mesh([], []))).toMatchObject({ status: 'inconclusive' });
    expect(topologyBirths(mesh([0, Number.NaN, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2]))).toMatchObject({ status: 'inconclusive' });
    expect(topologyBirths(mesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 3]))).toMatchObject({ status: 'inconclusive' });
  });

  it('does not trust non-manifold edges or duplicate source triangles', () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0];
    expect(topologyBirths(mesh(points, [0, 1, 2, 1, 0, 3, 0, 1, 4]))).toMatchObject({ status: 'inconclusive' });
    expect(topologyBirths(mesh(points, [0, 1, 2, 2, 1, 0]))).toMatchObject({ status: 'inconclusive' });
  });
});
