import { describe, expect, it } from 'vitest';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { supportMeshToUnitLocal } from './supportFrame';

describe('supportMeshToUnitLocal', () => {
  it('transforms contact-intent points with vertices while preserving source face and owner', () => {
    const built: GeneratedSupportMesh = {
      positions: new Float32Array([10, 2, 0, 11, 2, 0, 10, 3, 0]),
      indices: new Uint32Array([0, 1, 2]), parts: ['tree-branch'], dropped: [],
      components: [{ part: 'tree-branch', start: 0, count: 3, contactIntent: [
        { kind: 'primary', contactId: 'one', point: [10, 2, 0], normal: [0, -1, 0] },
        { kind: 'secondary', point: [11, 2, 0], normal: [0, 1, 0], faceIndex: 7 },
      ] }],
    };
    const local = supportMeshToUnitLocal(built, { position: [10, 0, 0], rotation: [0, 0, 0] });
    expect([...local.positions]).toEqual([0, 2, 0, 1, 2, 0, 0, 3, 0]);
    expect(local.components[0]!.contactIntent).toEqual([
      { kind: 'primary', contactId: 'one', point: [0, 2, 0], normal: [0, -1, 0] },
      { kind: 'secondary', point: [1, 2, 0], normal: [0, 1, 0], faceIndex: 7 },
    ]);
    expect(built.components[0]!.contactIntent![0]!.point).toEqual([10, 2, 0]);
  });

  it('rotates contact-intent normals into the same local frame as their points', () => {
    const built: GeneratedSupportMesh = {
      positions: new Float32Array([0, 1, 0, 1, 1, 0, 0, 2, 0]),
      indices: new Uint32Array([0, 1, 2]), parts: ['tree-branch'], dropped: [],
      components: [{ part: 'tree-branch', start: 0, count: 3, contactIntent: [
        { kind: 'primary', contactId: 'one', point: [0, 1, 0], normal: [0, 1, 0] },
      ] }],
    };
    const local = supportMeshToUnitLocal(built, { position: [0, 0, 0], rotation: [0, 0, Math.PI / 2] });
    const intent = local.components[0]!.contactIntent![0]!;
    expect(intent.point[0]).toBeCloseTo(1);
    expect(intent.point[1]).toBeCloseTo(0);
    expect(intent.normal[0]).toBeCloseTo(1);
    expect(intent.normal[1]).toBeCloseTo(0);
  });
});
