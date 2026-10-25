import { describe, expect, it } from 'vitest';
import { trianglesIntersect3D, type Triangle3D } from './triangleIntersection';

describe('trianglesIntersect3D', () => {
  it('finds a support triangle crossing a model triangle', () => {
    const model: Triangle3D = [[-1, 0, -1], [1, 0, -1], [0, 0, 1]];
    const body: Triangle3D = [[0, -1, 0], [0.5, 1, 0], [-0.5, 1, 0]];
    expect(trianglesIntersect3D(model, body)).toBe(true);
  });

  it('finds overlapping coplanar triangles but not separated ones', () => {
    const model: Triangle3D = [[-1, 0, -1], [1, 0, -1], [0, 0, 1]];
    const overlap: Triangle3D = [[-0.2, 0, -0.2], [0.2, 0, -0.2], [0, 0, 0.2]];
    const separated: Triangle3D = [[3, 0, 3], [4, 0, 3], [3, 0, 4]];
    expect(trianglesIntersect3D(model, overlap)).toBe(true);
    expect(trianglesIntersect3D(model, separated)).toBe(false);
  });
});
