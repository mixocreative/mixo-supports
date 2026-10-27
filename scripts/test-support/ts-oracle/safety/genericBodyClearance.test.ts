import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import type { GeneratedSupportMesh, SupportPart } from '../../../../src/core/supports/mesh';
import { createModelCollisionIndex } from './modelCollisionIndex';
import { defaultSupportSettings } from '../../../../src/core/supports/settings';
import { reviewGenericBodyClearance } from './genericBodyClearance';

const model: TriangleMesh = {
  positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]),
  indices: new Uint32Array([0, 1, 2]),
};
const supports = (part: SupportPart, vertices: number[], contactId?: string): GeneratedSupportMesh => ({
  positions: new Float32Array(vertices), indices: new Uint32Array([0, 1, 2]), parts: [part],
  components: [{ part, start: 0, count: 3, ...(contactId ? { contactId } : {}) }], dropped: [],
});
const piercing = [-1, -1, 0, 1, 1, 0, 1, -1, 0];

describe('reviewGenericBodyClearance', () => {
  it('reports a definite brace crossing with structural attribution', () => {
    const result = reviewGenericBodyClearance(model, supports('brace', piercing), defaultSupportSettings,
      new Map(), createModelCollisionIndex(model));
    expect(result.status).toBe('blocked');
    expect(result.issues).toMatchObject([{ part: 'brace', origin: 'structural', modelFaceIndex: 0 }]);
  });

  it('reports a manual pillar crossing without removing the manual contact', () => {
    const built = supports('pillar', piercing, 'manual-1');
    const result = reviewGenericBodyClearance(model, built, defaultSupportSettings,
      new Map([['manual-1', 'manual']]), createModelCollisionIndex(model));
    expect(result).toMatchObject({ status: 'blocked', issues: [{ part: 'pillar', contactId: 'manual-1', origin: 'manual' }] });
    expect(built.dropped).toEqual([]);
  });

  it('does not claim clear when an untagged contact neck intersects its model', () => {
    const result = reviewGenericBodyClearance(model, supports('neck', piercing, 'auto-1'), defaultSupportSettings,
      new Map([['auto-1', 'auto']]), createModelCollisionIndex(model));
    expect(result).toMatchObject({ status: 'inconclusive', issues: [{ part: 'neck', origin: 'auto' }] });
  });

  it('accepts only a face-tagged bounded intentional contact, not an unrelated wall', () => {
    const local = supports('neck', [-0.1, -0.05, -0.1, 0.1, 0.05, -0.1, 0, 0.05, 0.1], 'auto-1');
    local.components[0]!.contactIntent = [{ kind: 'primary', contactId: 'auto-1', point: [0, 0, 0],
      normal: [0, -1, 0], faceIndex: 0 }];
    expect(reviewGenericBodyClearance(model, local, defaultSupportSettings,
      new Map([['auto-1', 'auto']]), createModelCollisionIndex(model)).status).toBe('clear');
    const twoWalls: TriangleMesh = {
      positions: new Float32Array([...model.positions, -2, 0.5, -2, 2, 0.5, -2, 0, 0.5, 2]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const reaching = { ...local,
      positions: new Float32Array([...local.positions, -0.1, 0.4, -0.1, 0.1, 0.6, -0.1, 0, 0.6, 0.1]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      components: [{ ...local.components[0]!, count: 6 }],
    };
    expect(reviewGenericBodyClearance(twoWalls, reaching, defaultSupportSettings,
      new Map([['auto-1', 'auto']]), createModelCollisionIndex(twoWalls))).toMatchObject({
      status: 'blocked', issues: [{ modelFaceIndex: 1 }],
    });
  });

  it('returns inconclusive for invalid geometry instead of a false clear', () => {
    const broken: TriangleMesh = { positions: new Float32Array([Number.NaN, 0, 0]), indices: new Uint32Array([0, 1, 2]) };
    expect(reviewGenericBodyClearance(broken, supports('brace', piercing), defaultSupportSettings,
      new Map(), createModelCollisionIndex(broken)).status).toBe('inconclusive');
  });
});
