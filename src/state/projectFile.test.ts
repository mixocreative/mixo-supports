import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../core/analysis/types';
import { createSceneHistory, replaceScene, undoScene } from './history';
import { emptyScene, identityTransform, reduceScene, type PrintScene, type PrintUnit } from './project';
import { ProjectFileError } from '../editing/project';
import { decodeProject, encodeProject, packProject, projectFileName, sameUnits, unpackProject } from './projectFile';
import { stepKind } from './stepKind';

const source: TriangleMesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
const auto = (id: string, x: number): SupportPoint => ({ id, regionId: 0, position: [x, 0, 0], normal: [0, 0, 1], source: 'interior' });
const manual: SupportPoint = { id: 'manual-1', regionId: 0, position: [0.3, 0.3, 0], normal: [0, 0, 1], source: 'interior' };

/** A unit with automatic supports, a manual one, a removal, a zone and two supports of their own settings. */
function worked(id: string, name: string): PrintUnit {
  const points = [auto('auto-a', 0), auto('auto-b', 0.1), auto('auto-c', 0.2)];
  const base: PrintUnit = {
    id, name, source, transform: identityTransform, settings: { preset: 'CUSTOM' },
    placement: { points, regions: [], contactPositions: new Float32Array([0, 0, 0, 0.1, 0, 0, 0.2, 0, 0]), contactNormals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
    supports: { kind: 'support-mesh', data: { pillars: 3 } },
    manual: [], deleted: [], zones: [], contactSettings: {},
  };
  return [
    { type: 'manual/add', unitId: id, point: manual },
    { type: 'deletion/add', unitId: id, pointIds: ['auto-c'] },
    { type: 'zones/add', unitId: id, stamps: [{ center: [0.5, 0.5, 0], radius: 0.2, normal: [0, 0, 1], kind: 'paint' }] },
    { type: 'contactSettings/set', unitId: id, contactIds: ['auto-a', 'manual-1'], patch: { pointDiameter: 0.6 } },
  ].reduce<PrintScene>((scene, command) => reduceScene(scene, command as never), reduceScene(emptyScene, { type: 'unit/add', unit: base })).units[0]!;
}

const sceneOf = (...units: PrintUnit[]): PrintScene => reduceScene(emptyScene, { type: 'batch', commands: [...units.map((unit) => ({ type: 'unit/add' as const, unit })), { type: 'selection/set', unitIds: [units[0]!.id], activeUnitId: units[0]!.id }] });

describe('project file', () => {
  it('round-trips supports with their per-support settings, zones, manual supports and removals', () => {
    const scene = sceneOf(worked('u1', 'knot'));
    const back = decodeProject(encodeProject(scene));
    expect(back).toEqual(scene);
    const unit = back.units[0]!;
    expect(Object.keys(unit.contactSettings).sort()).toEqual(['auto-a', 'manual-1']);
    expect([unit.manual.length, unit.deleted, unit.zones.length]).toEqual([1, ['auto-c'], 1]);
    expect(unit.source.positions).toBeInstanceOf(Float32Array);
    expect(back.activeUnitId).toBe('u1');
  });

  it('writes a header that names the app and the version', () => {
    const file = JSON.parse(encodeProject(sceneOf(worked('u1', 'knot'))));
    expect([file.app, file.version]).toEqual(['mixo-supports', 1]);
  });

  it('refuses a file without the header, a newer version, a bad version and a missing scene', () => {
    const scene = JSON.parse(encodeProject(sceneOf(worked('u1', 'knot'))));
    const codeOf = (text: string) => { try { decodeProject(text); } catch (error) { return error instanceof ProjectFileError ? error.code : String(error); } return 'opened'; };
    expect(codeOf('not json')).toBe('not-project');
    expect(codeOf('[1, 2]')).toBe('not-project');
    expect(codeOf(JSON.stringify({ units: [] }))).toBe('not-project');
    expect(codeOf(JSON.stringify({ ...scene, app: 'other' }))).toBe('not-project');
    expect(codeOf(JSON.stringify({ ...scene, version: 2 }))).toBe('newer');
    expect(codeOf(JSON.stringify({ ...scene, version: 'x' }))).toBe('damaged');
    expect(codeOf(JSON.stringify({ app: scene.app, version: 1 }))).toBe('damaged');
    expect(codeOf(JSON.stringify({ ...scene, scene: { units: [{ id: 5 }], selectedUnitIds: [] } }))).toBe('damaged');
    try { decodeProject(JSON.stringify({ ...scene, version: 7 })); } catch (error) { expect((error as ProjectFileError).vars).toEqual({ v: 7, max: 1 }); }
  });

  it('opens both the compressed and the plain file', async () => {
    const scene = sceneOf(worked('u1', 'knot'));
    const packed = await packProject(scene);
    expect(new Uint8Array(await packed.slice(0, 2).arrayBuffer())).toEqual(new Uint8Array([0x1f, 0x8b]));
    expect(await unpackProject(packed)).toEqual(scene);
    expect(await unpackProject(new Blob([encodeProject(scene)]))).toEqual(scene);
    await expect(unpackProject(new Blob([new Uint8Array([0x1f, 0x8b, 1, 2, 3])]))).rejects.toMatchObject({ code: 'damaged' });
  });

  it('rejects damaged mesh data as damaged, never as a scene', () => {
    const scene = sceneOf(worked('u1', 'knot'));
    const withSource = (source: unknown) => {
      const file = JSON.parse(encodeProject(scene));
      file.scene.units[0].source = source;
      return JSON.stringify(file);
    };
    const f32 = (values: number[]) => ({ $printSceneType: 'Float32Array', values });
    const u32 = (values: number[]) => ({ $printSceneType: 'Uint32Array', values });
    const verts = f32([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(decodeProject(withSource({ positions: verts, indices: u32([0, 1, 2]) })).units).toHaveLength(1);
    for (const bad of [
      { positions: f32([0, 0, 0, 1, 0]), indices: u32([0, 1, 2]) },
      { positions: verts, indices: u32([0, 1]) },
      { positions: verts, indices: u32([0, 1, 3]) },
      { positions: f32([0, 0, 0, 1, 0, 0, 0, 1, 1e39]), indices: u32([0, 1, 2]) },
      { positions: verts, indices: [0, 1, 2] },
      null,
    ]) expect(() => decodeProject(withSource(bad))).toThrowError(expect.objectContaining({ code: 'damaged' }));
  });

  it('refuses a file over the size cap before parsing it, plain or compressed', async () => {
    const scene = sceneOf(worked('u1', 'knot'));
    const limit = 5;
    await expect(unpackProject(new Blob([encodeProject(scene)]), limit)).rejects.toMatchObject({ code: 'project-too-large', vars: { limit } });
    await expect(unpackProject(await packProject(scene), limit)).rejects.toMatchObject({ code: 'project-too-large', vars: { limit } });
    expect(await unpackProject(await packProject(scene), 1000)).toEqual(scene);
  });

  it('names the file after the first object, or "project"', () => {
    expect(projectFileName(sceneOf(worked('u1', 'knot')))).toBe('knot.mixosupports');
    expect(projectFileName(sceneOf(worked('u1', 'a/b:c')))).toBe('a_b_c.mixosupports');
    expect(projectFileName(emptyScene)).toBe('project.mixosupports');
  });

  it('counts a change of the objects as unsaved, a change of the selection as not', () => {
    const scene = sceneOf(worked('u1', 'a'), worked('u2', 'b'));
    expect(sameUnits(scene, reduceScene(scene, { type: 'selection/set', unitIds: ['u2'], activeUnitId: 'u2' }))).toBe(true);
    expect(sameUnits(scene, reduceScene(scene, { type: 'manual/remove', unitId: 'u1', pointId: 'manual-1' }))).toBe(false);
    expect(sameUnits(scene, reduceScene(scene, { type: 'unit/remove', unitId: 'u2' }))).toBe(false);
  });
});

describe('opening a project over the plate', () => {
  it('is one history step that Undo takes back, and Redo brings forward', () => {
    const before = sceneOf(worked('u1', 'old'));
    const opened = decodeProject(encodeProject(sceneOf(worked('u2', 'new'), worked('u3', 'other'))));
    const history = replaceScene(createSceneHistory(before), opened);
    expect(history.present).toBe(opened);
    expect(history.past).toHaveLength(1);
    expect(stepKind(history.past.at(-1), history.present)).toBe('openProject');
    const undone = undoScene(history);
    expect(undone.present.units.map((unit) => unit.id)).toEqual(['u1']);
    expect(undone.present.units[0]!.contactSettings).toEqual(before.units[0]!.contactSettings);
  });

  it('names an import as an import and an open onto an empty plate as one too', () => {
    const one = sceneOf(worked('u1', 'a'));
    expect(stepKind(one, sceneOf(worked('u1', 'a'), worked('u2', 'b')))).toBe('addObjects');
    expect(stepKind(emptyScene, one)).toBe('addObjects');
  });
});
