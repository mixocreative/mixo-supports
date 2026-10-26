import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh, SupportPart } from './mesh';
import { intersectingSupportComponents, supportBodyConflicts } from './bodyIntersection';
import { createModelCollisionIndex } from './modelCollisionIndex';

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
  it('passes a supplied model index through the compatibility view', () => {
    const index = createModelCollisionIndex(model);
    const otherModel = { ...model, positions: new Float32Array(model.positions) };
    const mesh = support('brace', piercing);
    expect(intersectingSupportComponents(model, mesh, () => true, false, index)).toEqual(mesh.components);
    expect(() => intersectingSupportComponents(otherModel, mesh, () => true, false, index))
      .toThrow('collision index belongs to another model');
  });
});

describe('supportBodyConflicts', () => {
  it('reports the exact model face and support triangle that intersect', () => {
    const mesh = support('tree-branch', [-1, -1, 0, 1, 1, 0, 1, -1, 0]);
    expect(supportBodyConflicts(model, mesh, () => true)).toEqual([
      { componentIndex: 0, component: mesh.components[0], supportTriangleIndex: 0, modelFaceIndex: 0 },
    ]);
  });

  it('continues past an approved local contact and reports a second wall hit', () => {
    const twoWalls: TriangleMesh = {
      positions: new Float32Array([...model.positions, -2, 2, -2, 2, 2, -2, 0, 2, 2]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const mesh = support('tree-branch', [-1, -1, 0, 1, 3, 0, 1, -1, 0]);
    expect(supportBodyConflicts(twoWalls, mesh, () => true, false,
      (hit) => hit.modelFaceIndex === 0)).toMatchObject([{ modelFaceIndex: 1 }]);
  });

  it('reuses one model index across part checks and refuses a different model', () => {
    const twoWalls: TriangleMesh = {
      positions: new Float32Array([...model.positions, -2, 2, -2, 2, 2, -2, 0, 2, 2]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const mesh = support('tree-branch', [-1, -1, 0, 1, 3, 0, 1, -1, 0]);
    const index = createModelCollisionIndex(twoWalls);
    const baseline = supportBodyConflicts(twoWalls, mesh, () => true, false,
      (hit) => hit.modelFaceIndex === 0);
    expect(supportBodyConflicts(twoWalls, mesh, () => true, false,
      (hit) => hit.modelFaceIndex === 0, index)).toEqual(baseline);
    expect(supportBodyConflicts(twoWalls, mesh, () => true, false, undefined, index)).toMatchObject([
      { modelFaceIndex: 0 },
    ]);
    expect(() => supportBodyConflicts(model, mesh, () => true, false, undefined, index))
      .toThrow('collision index belongs to another model');
  });
});
