import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh, SupportPart } from './mesh';
import { crossingAutomaticBodyContactIds } from './dentalBodyClearance';

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
