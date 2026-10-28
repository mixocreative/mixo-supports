import { describe, expect, it } from 'vitest';
import { emptyScene, reduceScene, type PrintScene, type PrintUnit, type SceneCommand } from './project';
import { stepKind } from './stepKind';

const mesh = { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };
const unit = { id: 'u', name: 'u', source: mesh, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, settings: {}, manual: [], deleted: [], zones: [], contactSettings: {} } as unknown as PrintUnit;
const point = { id: 'manual-1', regionId: -1, position: [0, 0, 0], normal: [0, -1, 0], source: 'interior' } as never;
const run = (scene: PrintScene, ...commands: SceneCommand[]) => commands.reduce(reduceScene, scene);

describe('stepKind', () => {
  const base = run(emptyScene, { type: 'unit/add', unit });
  it('names what a step did', () => {
    expect(stepKind(emptyScene, base)).toBe('addObjects');
    expect(stepKind(base, run(base, { type: 'unit/remove', unitId: 'u' }))).toBe('deleteObjects');
    expect(stepKind(base, run(base, { type: 'transform/set', unitId: 'u', transform: { position: [1, 0, 0], rotation: [0, 0, 0] } }))).toBe('move');
    const added = run(base, { type: 'manual/add', unitId: 'u', point });
    expect(stepKind(base, added)).toBe('addSupport');
    expect(stepKind(added, run(added, { type: 'supports/clear-manual', unitId: 'u' }))).toBe('clearManual');
    expect(stepKind(base, run(base, { type: 'deletion/add', unitId: 'u', pointIds: ['a'] }))).toBe('deleteSupports');
    expect(stepKind(base, run(base, { type: 'zones/add', unitId: 'u', stamps: [{ center: [0, 0, 0], radius: 1, normal: [0, 1, 0], kind: 'paint' }] }))).toBe('zones');
  });
  it('names a paint or erase stroke (or any change of the dental area) a support area step, ahead of the support test', () => {
    const area = (dental: object): PrintScene => ({ ...base, units: [{ ...base.units[0]!, dental } as unknown as PrintUnit] });
    const before = area({ kind: 'two-contour', stamps: [] });
    const after = area({ kind: 'two-contour', stamps: [{ kind: 'allow' }] });
    expect(stepKind(before, after)).toBe('dentalArea');
    const withSupports: PrintScene = { ...after, units: [{ ...after.units[0]!, supports: { kind: 'live', data: {} } } as unknown as PrintUnit] };
    expect(stepKind(before, withSupports)).toBe('dentalArea');
  });
  it('says nothing for a selection change or a missing scene', () => {
    expect(stepKind(base, run(base, { type: 'selection/set', unitIds: ['u'], activeUnitId: 'u' }))).toBeUndefined();
    expect(stepKind(undefined, base)).toBeUndefined();
  });
});
