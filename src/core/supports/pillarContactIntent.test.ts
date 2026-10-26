import { describe, expect, it } from 'vitest';
import { buildSupportMesh, type SupportContact } from './mesh';
import { defaultSupportSettings } from './settings';
import { crossingSupportStructureParts } from './dentalBodyClearance';
import type { TriangleMesh } from '../analysis/types';

describe('pillar neck contact provenance', () => {
  it('tags a certified primary face without changing generated geometry', () => {
    const contact: SupportContact = { id: 'rim', position: [0, 12, 0], normal: [0, -1, 0] };
    const settings = { ...defaultSupportSettings, raftEnabled: false, trussEnabled: false };
    const untagged = buildSupportMesh([contact], settings);
    const tagged = buildSupportMesh([{ ...contact, sourceFace: 7 }], settings);
    expect(tagged.components.find((component) => component.part === 'neck')?.contactIntent).toEqual([
      { kind: 'primary', contactId: 'rim', point: [0, 12, 0], normal: [0, -1, 0], faceIndex: 7 },
    ]);
    expect(tagged.positions).toEqual(untagged.positions);
    expect(tagged.indices).toEqual(untagged.indices);
  });

  it('does not misclassify a tagged pillar neck as a Tree structure', () => {
    const model: TriangleMesh = {
      positions: new Float32Array([
        10, 12, -1, 11, 12, -1, 10, 12, 1,
        -0.5, 11.5, -0.5, 0.5, 11.5, -0.5, 0, 11.5, 0.5,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 5, 4]),
    };
    const settings = { ...defaultSupportSettings, raftEnabled: false, trussEnabled: false };
    const built = buildSupportMesh([
      { id: 'rim', position: [0, 12, 0], normal: [0, -1, 0], sourceFace: 0 },
    ], settings);
    expect(crossingSupportStructureParts(model, built, settings)).toEqual([]);
  });
});
