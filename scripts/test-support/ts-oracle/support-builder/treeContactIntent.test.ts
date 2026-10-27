import { describe, expect, it } from 'vitest';
import { buildSupportMesh, treeGeometry, type SupportContact } from './mesh';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import { crossingSupportStructureParts } from '../../../../src/core/supports/dentalBodyClearance';
import { supportBodyConflicts } from '../../../../src/core/supports/bodyIntersection';
import type { LineTarget } from './landing';
import { defaultSupportSettings } from '../../../../src/core/supports/settings';

describe('tree contact intent provenance', () => {
  const contacts: SupportContact[] = [
    { id: 'left', position: [-1, 12, 0], normal: [0, -1, 0] },
    { id: 'right', position: [1, 12, 0], normal: [0, -1, 0] },
  ];

  it('records both leaf contacts and the secondary landing on a joined two-leaf branch', () => {
    const ray = { height: 20, cast: () => ({ point: [0, 4, 0], normal: [0, 1, 0], faceIndex: 3 }) } as unknown as LineTarget;
    const geometry = treeGeometry({ junction: [0, 8, 0], members: [0, 1] }, contacts,
      { ...defaultSupportSettings, contactShape: 'NONE' }, ray);
    const branch = geometry.curves.find((curve) => curve.part === 'tree-branch')!;
    expect(branch.contactIntent).toEqual([
      { kind: 'primary', contactId: 'left', point: [-1, 12, 0], normal: [0, -1, 0] },
      { kind: 'primary', contactId: 'right', point: [1, 12, 0], normal: [0, -1, 0] },
      { kind: 'secondary', point: [0, 4, 0], normal: [0, 1, 0], faceIndex: 3 },
    ]);
  });

  it('retains an exact primary source-face identity when the contact supplies one', () => {
    const tagged = contacts.map((contact, index) => ({ ...contact, sourceFace: index + 6 }));
    const geometry = treeGeometry({ junction: [0, 8, 0], members: [0, 1] }, tagged,
      { ...defaultSupportSettings, contactShape: 'NONE' }, undefined);
    expect(geometry.curves.filter((curve) => curve.part === 'tree-branch')
      .flatMap((curve) => curve.contactIntent?.filter((intent) => intent.kind === 'primary') ?? []))
      .toEqual(expect.arrayContaining([
        { kind: 'primary', contactId: 'left', point: [-1, 12, 0], normal: [0, -1, 0], faceIndex: 6 },
        { kind: 'primary', contactId: 'right', point: [1, 12, 0], normal: [0, -1, 0], faceIndex: 7 },
      ]));
  });

  it('carries primary intent to built tree components without calling it clearance', () => {
    const built = buildSupportMesh(contacts, { ...defaultSupportSettings, scatterAutoTree: true });
    const branches = built.components.filter((component) => component.part === 'tree-branch');
    expect(branches.length).toBeGreaterThan(0);
    expect(new Set(branches.flatMap((branch) => branch.contactIntent?.flatMap((intent) =>
      intent.kind === 'primary' ? [intent.contactId] : []) ?? []))).toEqual(new Set(['left', 'right']));
    expect(built.components.filter((component) => component.part === 'tree-trunk')
      .every((component) => component.contactIntent === undefined)).toBe(true);
  });

  it('keeps the primary intent on shaped necks split off tree branches', () => {
    const built = buildSupportMesh(contacts,
      { ...defaultSupportSettings, scatterAutoTree: true, tipSection: 'SQUARE' });
    const necks = built.components.filter((component) => component.part === 'neck' && component.contactId);
    expect(new Set(necks.flatMap((neck) => neck.contactIntent?.flatMap((intent) =>
      intent.kind === 'primary' ? [intent.contactId] : []) ?? []))).toEqual(new Set(['left', 'right']));
  });

  it.each(['ROUND', 'SQUARE'] as const)(
    'builds a two-leaf Tree with %s tips, two primary intents and a secondary model landing', (tipSection) => {
    const lowerShelf: TriangleMesh = {
      positions: new Float32Array([
        -0.4, 4, -0.4, 0.4, 4, -0.4, 0, 4, 0.4,
        10, 8, -1, 11, 8, -1, 10, 8, 1,
      ]),
      indices: new Uint32Array([0, 2, 1, 3, 4, 5]),
    };
    const settings = { ...defaultSupportSettings, scatterAutoTree: true, scatterSafeDistance: 0,
      lowPolyMode: true, tipSection };
    const built = buildSupportMesh(contacts, settings,
      { model: lowerShelf });
    const joined = built.components.find((component) => component.part === 'tree-branch' &&
      component.contactIntent?.some((intent) => intent.kind === 'secondary'));
    expect(joined).toBeDefined();
    expect(joined?.contactIntent?.filter((intent) => intent.kind === 'primary').map((intent) =>
      intent.kind === 'primary' ? intent.contactId : '')).toEqual(['left', 'right']);
    expect(joined?.contactIntent?.some((intent) => intent.kind === 'secondary' && intent.faceIndex === 0)).toBe(true);
    expect(crossingSupportStructureParts(lowerShelf, built, settings)).toEqual([]);
    const otherWall: TriangleMesh = {
      positions: new Float32Array([...lowerShelf.positions, -0.5, 6, -0.5, 0.5, 6, -0.5, 0, 6, 0.5]),
      indices: new Uint32Array([...lowerShelf.indices, 6, 8, 7]),
    };
    expect(crossingSupportStructureParts(otherWall, built, settings)).toContain('tree-branch');
    const tipWall: TriangleMesh = {
      positions: new Float32Array([...lowerShelf.positions,
        -1.4, 11.5, -0.5, -0.6, 11.5, -0.5, -1, 11.5, 0.5]),
      indices: new Uint32Array([...lowerShelf.indices, 6, 8, 7]),
    };
    expect(crossingSupportStructureParts(tipWall, built, settings)).toContain('tree-branch');
    },
  );

  it('accepts adjacent faces at both built primary Tree contacts', () => {
    const model: TriangleMesh = {
      positions: new Float32Array([
        -0.4, 4, -0.4, 0.4, 4, -0.4, 0, 4, 0.4,
        10, 8, -1, 11, 8, -1, 10, 8, 1,
        -1.4, 12, -0.4, -0.6, 12, -0.4, -1.4, 12, 0.4, -0.6, 12, 0.4,
        0.6, 12, -0.4, 1.4, 12, -0.4, 0.6, 12, 0.4, 1.4, 12, 0.4,
      ]),
      indices: new Uint32Array([0, 2, 1, 3, 4, 5, 6, 7, 8, 8, 7, 9, 10, 11, 12, 12, 11, 13]),
    };
    const settings = { ...defaultSupportSettings, scatterAutoTree: true, scatterSafeDistance: 0, lowPolyMode: true };
    const built = buildSupportMesh(contacts.map((contact, index) => ({ ...contact, sourceFace: 2 + index * 2 })),
      settings, { model });
    const primaryHits = new Set<number>();
    supportBodyConflicts(model, built, (component) => component.part === 'tree-branch', false, (hit) => {
      primaryHits.add(hit.modelFaceIndex);
      return true;
    });
    expect(primaryHits).toEqual(new Set([2, 3, 4, 5]));
    expect(crossingSupportStructureParts(model, built, settings)).toEqual([]);
  });
});
