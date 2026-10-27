import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import type { GeneratedSupportMesh } from '../../../../src/core/supports/mesh';
import type { SupportBodyConflict } from './bodyIntersection';
import { isIntentionalContactReach } from './contactReach';

const model: TriangleMesh = {
  positions: new Float32Array([
    -2, 0, -2, 2, 0, -2, 0, 0, 2,
    -2, 0.1, -2, 2, 0.1, -2, 0, 0.1, 2,
  ]),
  indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
};
const limits = { radiusMm: 0.6, penetrationMm: 0.2, faceNormalDotMin: 0.8 };

function fixture(vertices: number[], modelFaceIndex: number, intentFace = 0) {
  const supports: GeneratedSupportMesh = {
    positions: new Float32Array(vertices), indices: new Uint32Array([0, 1, 2]),
    parts: ['tree-branch'], dropped: [], components: [{
      part: 'tree-branch', start: 0, count: 3,
      contactIntent: [{ kind: 'primary', contactId: 'tip-a', point: [0, 0, 0], normal: [0, -1, 0], faceIndex: intentFace }],
    }],
  };
  const hit: SupportBodyConflict = { componentIndex: 0, component: supports.components[0]!,
    supportTriangleIndex: 0, modelFaceIndex };
  return { supports, hit };
}

describe('isIntentionalContactReach', () => {
  const near = [-0.1, -0.1, 0, 0.1, 0.05, 0, 0.1, -0.1, 0];

  it('accepts a shallow hit on the explicitly intended source face', () => {
    const { supports, hit } = fixture(near, 0);
    expect(isIntentionalContactReach(model, supports, hit, limits)).toBe(true);
  });

  it('rejects a second wall even when it is geometrically near the intended tip', () => {
    const { supports, hit } = fixture(near, 1);
    expect(isIntentionalContactReach(model, supports, hit, limits)).toBe(false);
  });

  it('accepts a shallow hit on an edge-adjacent face of the same smooth surface', () => {
    const sheet: TriangleMesh = {
      positions: new Float32Array([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
    };
    const { supports, hit } = fixture(near, 1);
    expect(isIntentionalContactReach(sheet, supports, hit, limits)).toBe(true);
  });

  it('does not cross a shared edge when the source face points the opposite way', () => {
    const folded: TriangleMesh = {
      positions: new Float32Array([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 2, 1, 2, 1, 3]),
    };
    const { supports, hit } = fixture(near, 1);
    expect(isIntentionalContactReach(folded, supports, hit, limits)).toBe(false);
  });

  it('rejects a distant branch span or excessive penetration on the intended face', () => {
    const far = fixture([-0.1, -0.1, 0, 2, 0.05, 0, 0.1, -0.1, 0], 0);
    const deep = fixture([-0.1, -0.1, 0, 0.1, 0.4, 0, 0.1, -0.1, 0], 0);
    expect(isIntentionalContactReach(model, far.supports, far.hit, limits)).toBe(false);
    expect(isIntentionalContactReach(model, deep.supports, deep.hit, limits)).toBe(false);
  });
});
