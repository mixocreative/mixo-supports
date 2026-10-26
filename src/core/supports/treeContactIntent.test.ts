import { describe, expect, it } from 'vitest';
import { buildSupportMesh, treeGeometry, type SupportContact } from './mesh';
import type { LineTarget } from './landing';
import { defaultSupportSettings } from './settings';

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
});
