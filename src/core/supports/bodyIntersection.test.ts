import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh, SupportPart } from './mesh';
import { intersectingSupportComponents } from './bodyIntersection';

const model: TriangleMesh = {
  positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]),
  indices: new Uint32Array([0, 1, 2]),
};

function support(part: SupportPart, vertices: number[], landingReach?: number): GeneratedSupportMesh {
  return {
    positions: new Float32Array(vertices), indices: new Uint32Array([0, 1, 2]), parts: [part],
    components: [{ part, start: 0, count: 3, ...(landingReach === undefined ? {} : { landingReach }) }], dropped: [],
  };
}

describe('intersectingSupportComponents', () => {
  const piercing = [-1, -1, 0, 1, 1, 0, 1, -1, 0];
  it('selects exact intersecting built parts independently of dental policy', () => {
    const mesh = support('brace', piercing);
    expect(intersectingSupportComponents(model, mesh, () => true)).toEqual(mesh.components);
    expect(intersectingSupportComponents(model, mesh, (part) => part.part === 'pillar')).toEqual([]);
    expect(intersectingSupportComponents(model, support('brace', [-1, 1, 0, 1, 2, 0, 1, 1, 0]), () => true)).toEqual([]);
  });
  it('exempts only explicitly marked landing-tip reach when requested', () => {
    const mesh = support('pillar', piercing, 5);
    expect(intersectingSupportComponents(model, mesh, () => true)).toEqual(mesh.components);
    expect(intersectingSupportComponents(model, mesh, () => true, true)).toEqual([]);
  });
});
