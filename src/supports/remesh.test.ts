import { describe, expect, it } from 'vitest';
import blender from '../../tools/blender-parity/remesh_spike.json';
import { RemeshTarget } from './remesh';

/**
 * The SLASG_Line remesh against Blender (tools/blender-parity/remesh_dump.py): the probe spike,
 * apex down at y = 5, top +-3 mm at y = 8, voxel 0.8. Blender (x, y, z) = web (x, -z, y).
 */
const spike = {
  positions: new Float32Array([0, 5, 0, -3, 8, 3, 3, 8, 3, 3, 8, -3, -3, 8, -3]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 1, 2, 3, 1, 3, 4]),
};

describe('RemeshTarget', () => {
  const target = new RemeshTarget(spike, 0.8);

  it('reproduces every vertex of the adaptivity-0 remesh', () => {
    const duals = target as unknown as { dual(i: number, j: number, k: number): [number, number, number] | null };
    const ours: [number, number, number][] = [];
    for (let i = -5; i <= 5; i += 1) for (let j = 5; j <= 11; j += 1) for (let k = -5; k <= 5; k += 1) {
      const vertex = duals.dual(i, j, k);
      if (vertex) ours.push([vertex[0], -vertex[2], vertex[1]]);
    }
    const near = (a: readonly number[], list: readonly (readonly number[])[]) => list.some((b) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) < 1e-3);
    for (const vertex of blender.verts) expect(near(vertex, ours), `${vertex}`).toBe(true);
    for (const vertex of ours) expect(near(vertex, blender.verts), `${vertex}`).toBe(true);
  });

  it('lands below the apex where the Blender raycast does', () => {
    expect(target.castDown([-0.152, 5.952, 0.152], 10)!.point[1]).toBeCloseTo(5.4188, 3);
    expect(target.castDown([0.7878, 6.588, 0], 10)!.point[1]).toBeCloseTo(5.9253, 3);
  });

  it('gives the Resin UV neck directions for edge contacts (mean of the edge vertex normals)', () => {
    // Web contact, then the Resin UV neck offset for Connection Length 2 at 45° (from its feet).
    const cases: [[number, number, number], [number, number]][] = [
      [[0.755, 6.1225, 1.1225], [0.605, 1.043]],
      [[-0.755, 6.1225, -1.1225], [-0.605, -1.043]],
      [[2.7878, 7.7878, -1], [1.413, -0.063]],
      [[1, 7.7878, -2.7878], [0.063, -1.413]],
    ];
    for (const [point, expected] of cases) {
      const n = target.normalAt(point, 'edge')!;
      const reach = Math.acos(-n[1]) <= Math.PI / 4 ? 2 : 2 * Math.SQRT1_2 / Math.hypot(n[0], n[2]);
      expect(Math.hypot(n[0] * reach - expected[0], n[2] * reach - expected[1])).toBeLessThan(5e-3);
    }
  });
});
