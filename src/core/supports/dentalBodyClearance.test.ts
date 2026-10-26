import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh, SupportPart } from './mesh';
import { crossingAutomaticBodyContactIds, crossingSupportStructureParts } from './dentalBodyClearance';

const surface: TriangleMesh = {
  positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]), indices: new Uint32Array([0, 1, 2]),
};

function body(part: SupportPart, vertices: number[], contactId = 'auto-1', landingReach?: number): GeneratedSupportMesh {
  return { positions: new Float32Array(vertices), indices: new Uint32Array([0, 1, 2]), parts: [part],
    components: [{ part, contactId, start: 0, count: 3, ...(landingReach === undefined ? {} : { landingReach }) }], dropped: [] };
}

describe('crossingAutomaticBodyContactIds', () => {
  const piercing = [-1, -1, 0, 1, 1, 0, 1, -1, 0];
  it('rejects an automatic pillar piercing a model face', () => {
    expect(crossingAutomaticBodyContactIds(surface, body('pillar', piercing), new Set(['auto-1']))).toEqual(['auto-1']);
  });
  it('keeps a separated pillar and an intended neck contact', () => {
    expect(crossingAutomaticBodyContactIds(surface, body('pillar', [-1, 1, 0, 1, 2, 0, 1, 1, 0]), new Set(['auto-1']))).toEqual([]);
    expect(crossingAutomaticBodyContactIds(surface, body('neck', piercing), new Set(['auto-1']))).toEqual([]);
  });
  it('does not reject an explicit secondary landing tip or a manual pillar', () => {
    expect(crossingAutomaticBodyContactIds(surface, body('pillar', piercing, 'auto-1', 5), new Set(['auto-1']))).toEqual([]);
    expect(crossingAutomaticBodyContactIds(surface, body('pillar', piercing, 'manual-1'), new Set())).toEqual([]);
  });
  it('rejects a coplanar pillar face lying on the model', () => {
    expect(crossingAutomaticBodyContactIds(surface,
      body('pillar', [-1, 0, 0, 1, 0, 0, 0, 0, 1]), new Set(['auto-1']))).toEqual(['auto-1']);
  });
});

describe('crossingSupportStructureParts', () => {
  const piercing = [-1, -1, 0, 1, 1, 0, 1, -1, 0];
  it('reports a crossing tree branch, trunk, or brace without treating an intended neck as structure', () => {
    for (const part of ['tree-branch', 'tree-trunk', 'brace'] as const) {
      expect(crossingSupportStructureParts(surface, body(part, piercing))).toEqual([part]);
    }
    expect(crossingSupportStructureParts(surface, body('neck', piercing))).toEqual([]);
  });
  it('accepts structures that stay clear of the model', () => {
    expect(crossingSupportStructureParts(surface, body('tree-branch', [-1, 1, 0, 1, 2, 0, 1, 1, 0]))).toEqual([]);
  });

  it('allows only a shallow tree reach on its known face, never a nearby second wall', () => {
    const near = body('tree-branch', [-0.1, -0.1, 0, 0.1, 0.05, 0, 0.1, -0.1, 0]);
    near.components[0]!.contactIntent = [
      { kind: 'primary', contactId: 'auto-1', point: [0, 0, 0], normal: [0, -1, 0], faceIndex: 0 },
    ];
    expect(crossingSupportStructureParts(surface, near)).toEqual([]);
    const secondWall: TriangleMesh = {
      positions: new Float32Array([...surface.positions, -2, 0.02, -2, 2, 0.02, -2, 0, 0.02, 2]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    expect(crossingSupportStructureParts(secondWall, near)).toEqual(['tree-branch']);
  });
});
