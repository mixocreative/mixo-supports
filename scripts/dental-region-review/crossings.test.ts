import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../src/core/analysis/types';
import type { GeneratedSupportMesh } from '../../src/core/supports/mesh';
import { diagnoseSupportCrossings } from './crossings';

const model: TriangleMesh = {
  positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]),
  indices: new Uint32Array([0, 1, 2]),
};

function supports(positions: number[]): GeneratedSupportMesh {
  return {
    positions: new Float32Array(positions), indices: new Uint32Array([0, 1, 2]),
    parts: ['pillar'], components: [{ part: 'pillar', contactId: 'a', start: 0, count: 3 }], dropped: [],
  };
}

describe('diagnoseSupportCrossings', () => {
  it('reports a shaft triangle piercing a model face with its owning contact', () => {
    const result = diagnoseSupportCrossings(model, supports([-1, -1, 0, 1, 1, 0, 1, -1, 0]));
    expect(result.total).toBe(1);
    expect(result.byPart.pillar).toBe(1);
    expect(result.bodyPillarCrossings).toBe(1);
    expect(result.contactIdsByPart.pillar).toEqual(['a']);
    expect(result.examples[0]).toMatchObject({ modelFace: 0, supportFace: 0, part: 'pillar', contactId: 'a' });
  });

  it('does not report a separated shaft', () => {
    const result = diagnoseSupportCrossings(model, supports([-1, 1, 0, 1, 2, 0, 1, 1, 0]));
    expect(result.total).toBe(0);
  });

  it('counts crossings on faces outside the contact band', () => {
    const result = diagnoseSupportCrossings(model, supports([-1, -1, 0, 1, 1, 0, 1, -1, 0]), new Uint8Array([0]));
    expect(result.outsideContactBand.pillar).toBe(1);
  });

  it('separates a pillar secondary-landing tip from the shaft', () => {
    const support = supports([-1, -1, 0, 1, 1, 0, 1, -1, 0]);
    support.components[0]!.landingReach = 5;
    const result = diagnoseSupportCrossings(model, support);
    expect(result.byPart.pillar).toBe(1);
    expect(result.bodyPillarCrossings).toBe(0);
  });

  it('measures neck intersection reach from its intended contact', () => {
    const support = supports([-1, -1, 0, 1, 1, 0, 1, -1, 0]);
    support.components[0]!.part = 'neck';
    const result = diagnoseSupportCrossings(model, support, undefined, new Map([['a', [0, 0, 0] as [number, number, number]]]));
    expect(result.neckReach?.measuredPairs).toBe(1);
    expect(result.neckReach?.maxDistanceMm).toBeCloseTo(1);
  });
});
