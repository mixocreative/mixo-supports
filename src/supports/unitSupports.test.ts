import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../core/analysis/types';
import { identityTransform, type PrintUnit } from '../state/project';
import { applyTransform } from '../state/transform';
import { meshBounds } from '../core/supports/meshQuery';
import { defaultSupportSettings } from '../core/supports/settings';
import { hiddenByZones, resolveSettings, unitContacts, unitRemovedCount, unitSupportMesh } from './unitSupports';

// A closed 10 mm cube: its underside (y = -5) is where the contacts sit.
const source: TriangleMesh = {
  positions: new Float32Array([-5, -5, -5, 5, -5, -5, 5, -5, 5, -5, -5, 5, -5, 5, -5, 5, 5, -5, 5, 5, 5, -5, 5, 5]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]),
};
const point = (id: string, x: number): SupportPoint => ({ id, regionId: 0, position: [x, -5, 0], normal: [0, -1, 0], source: 'interior' });
const generated = { position: [0, 10, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
const unit: PrintUnit = {
  id: 'unit-a', name: 'A', source, transform: generated, settings: { ...defaultSupportSettings },
  placement: { points: [point('auto-0', 0), point('auto-1', 3)], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() },
  supports: { kind: 'live', data: { transform: generated } },
  manual: [point('manual-a', -3)],
  deleted: ['auto-1'],
  zones: [],
};

describe('unit supports', () => {
  it('hides automatic contacts inside a no-support zone but keeps manual ones', () => {
    const zoned: PrintUnit = {
      ...unit,
      deleted: [],
      manual: [point('manual-a', 0)],
      zones: [{ center: [0, -5, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' }],
    };
    expect(unitContacts(zoned, undefined).map((contact) => contact.id)).toEqual(['auto-1', 'manual-a']);
  });

  it('counts the supports its zones hide: those a zone covers and those a build dropped', () => {
    const zoned: PrintUnit = { ...unit, deleted: [], manual: [], zones: [{ center: [0, -5, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' }] };
    expect(hiddenByZones(unit, undefined)).toBe(0);
    expect(hiddenByZones(zoned, undefined)).toBe(1);
    expect(hiddenByZones(zoned, { dropped: ['auto-1'] })).toBe(2);
  });

  it('computes the contacts once per unit object and hands out a read-only list', () => {
    const first = unitContacts(unit, undefined);
    expect(unitContacts(unit, undefined)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    // A changed unit is a new object: its own list.
    const zoned: PrintUnit = { ...unit, zones: [{ center: [0, -5, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' }] };
    expect(unitContacts(zoned, undefined)).not.toBe(first);
    expect(unitContacts(zoned, undefined).map((contact) => contact.id)).toEqual(['manual-a']);
  });

  it('leaves out the contacts the latest build dropped for landing in a zone, once per unit and build', () => {
    const built = { dropped: ['auto-0'] };
    const kept = unitContacts(unit, built);
    expect(kept.map((contact) => contact.id)).toEqual(['manual-a']);
    expect(Object.isFrozen(kept)).toBe(true);
    expect(unitContacts(unit, built)).toBe(kept);
    // A build that dropped nothing gives the unit's full list back.
    expect(unitContacts(unit, { dropped: [] })).toBe(unitContacts(unit, undefined));
  });

  it('counts only the removals that hide a contact', () => {
    expect(unitRemovedCount(unit)).toBe(1);
    // A deletion of a spot that is gone and one made before any placement hide nothing.
    expect(unitRemovedCount({ ...unit, deleted: ['auto-1', 'auto-9999_9999_9999'] })).toBe(1);
    expect(unitRemovedCount({ ...unit, placement: undefined, deleted: ['auto-0'] })).toBe(0);
  });

  it('merges settings over defaults and composes contacts', () => {
    expect(resolveSettings({ preset: 'HEAVY', touchDiameter: 1 })).toMatchObject({ preset: 'HEAVY', touchDiameter: 1, raftEnabled: true });
    expect(unitContacts(unit, undefined).map((contact) => contact.id)).toEqual(['auto-0', 'manual-a']);
  });

  it('builds supports in unit space that reach the plate at the generation transform', () => {
    const mesh = unitSupportMesh(unit, 0);
    const world = meshBounds(applyTransform(mesh, unit.transform));
    expect(world.min[1]).toBeCloseTo(0);
    // The bare tip sinks Penetration (0.2 mm) into the model's underside at y = 5 to fuse with it
    // (along the remeshed surface normal, so within a few microns).
    expect(world.max[1]).toBeCloseTo(5 + defaultSupportSettings.pointDepth, 2);
  });

  it('keeps supports rigid with the model when the unit moves afterwards', () => {
    const moved = { ...unit, transform: { position: [20, 15, 0] as [number, number, number], rotation: [0, 0.5, 0] as [number, number, number] } };
    expect(unitSupportMesh(moved, 0).positions).toEqual(unitSupportMesh(unit, 0).positions);
  });

  it('builds nothing without contacts or after supports were removed', () => {
    expect(unitSupportMesh({ ...unit, placement: undefined, manual: [] }, 0).indices.length).toBe(0);
    expect(unitSupportMesh({ ...unit, supports: undefined }, 0).indices.length).toBe(0);
  });

  it('uses the current transform when manual-only supports have no stored frame', () => {
    const manualOnly = {
      ...unit, placement: undefined, supports: { kind: 'live', data: {} }, transform: identityTransform,
      manual: [{ ...point('manual-a', 0), position: [0, 10, 0] as [number, number, number] }],
    };
    expect(meshBounds(unitSupportMesh(manualOnly, 0)).min[1]).toBeCloseTo(0);
  });
});

describe('unitLowestY', () => {
  it('equals the lowest point of the transformed copy, bit for bit', async () => {
    const { meshBounds } = await import('../core/supports/meshQuery');
    const { applyTransform } = await import('../state/transform');
    const { unitLowestY } = await import('./unitSupports');
    const positions = new Float32Array(300).map((_, k) => Math.sin(k * 12.9898) * 20.123);
    const unit = { source: { positions, indices: new Uint32Array([0, 1, 2]) }, transform: { position: [3.3, 7.77, -1.5] as [number, number, number], rotation: [0.4, -1.1, 0.25] as [number, number, number] } } as never;
    expect(unitLowestY(unit)).toBe(meshBounds(applyTransform((unit as { source: never }).source, (unit as { transform: never }).transform)).min[1]);
  });
});

describe('placementCommands (a finished placement meets the unit as it is now)', () => {
  const requested = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
  const result = { points: [point('auto-0', 0)], regions: [] };
  const lift = 5;

  it('keeps a move made while the placement ran and lifts the model to Lift Height', async () => {
    const { placementCommands } = await import('./unitSupports');
    const moved: PrintUnit = { ...unit, transform: { position: [30, 10, -4], rotation: [0, 0, 0] } };
    const commands = placementCommands(moved, requested, result, lift, 1.5)!;
    expect(commands[0]).toEqual({ type: 'transform/set', unitId: 'unit-a', transform: { position: [30, 10, -4], rotation: [0, 0, 0] } });
    expect(commands[1]).toMatchObject({ type: 'supports/set', unitId: 'unit-a', supports: { kind: 'live', data: { transform: { position: [30, 10, -4], rotation: [0, 0, 0] } } } });
    // Lowest point (local y = -5) at the plate plus Lift Height.
    const low: PrintUnit = { ...unit, transform: { position: [30, 2, -4], rotation: [0, 0, 0] } };
    expect(placementCommands(low, requested, result, lift, 1.5)![0]).toMatchObject({ transform: { position: [30, 10, -4] } });
  });

  it('maps contacts back to unit-local space through the requested orientation', async () => {
    const { placementCommands } = await import('./unitSupports');
    const turned = { position: [0, 0, 0] as [number, number, number], rotation: [Math.PI, 0, 0] as [number, number, number] };
    const now: PrintUnit = { ...unit, transform: { position: [0, 10, 0], rotation: [Math.PI, 0, 0] } };
    const placed = { points: [{ ...point('auto-0', 2), position: [2, 5, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number] }], regions: [] };
    const set = placementCommands(now, turned, placed, lift, 1.5)![1] as { placement: { points: { position: number[]; normal: number[] }[] } };
    expect(set.placement.points[0]!.position.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([2, -5, 0]);
    expect(set.placement.points[0]!.normal.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 1, 0]);
  });

  it('applies nothing when the unit was rotated meanwhile (its contacts face the old way)', async () => {
    const { placementCommands } = await import('./unitSupports');
    const rotated: PrintUnit = { ...unit, transform: { position: [0, 10, 0], rotation: [0, 0.5, 0] } };
    expect(placementCommands(rotated, requested, result, lift, 1.5)).toBeUndefined();
  });
});

describe('deleted contacts after Regenerate on a rotated unit', () => {
  it('hide the contact nearest the deleted one, in the unit-local frame', async () => {
    const { placementCommands, orientationOf } = await import('./unitSupports');
    const { reduceScene, emptyScene } = await import('../state/project');
    const { transformPoint } = await import('../state/transform');
    const { deleteCommands } = await import('./selection');
    const rotated = { position: [0, 10, 0] as [number, number, number], rotation: [0, Math.PI / 2, 0] as [number, number, number] };
    const base: PrintUnit = { ...unit, transform: rotated, placement: undefined, supports: undefined, manual: [], deleted: [] };
    const orientation = orientationOf(base);
    const idOf = (p: readonly number[]) => `auto-${p.map((v) => Math.round(v * 100)).join('_')}`;
    // Placement reports contacts in the turned frame, named by that frame, as runPlacementJob does.
    const placed = (xs: number[]) => ({
      points: xs.map((x) => {
        const turned = transformPoint(orientation, [x, -5, 0]);
        return { id: idOf(turned), regionId: 0, position: turned, normal: [0, -1, 0] as [number, number, number], source: 'interior' as const };
      }),
      regions: [],
    });
    const spacing = 3;
    const apply = (scene: ReturnType<typeof reduceScene>, xs: number[]) => {
      const now = scene.units[0]!;
      return reduceScene(scene, { type: 'batch', commands: placementCommands(now, orientation, placed(xs), 5, spacing / 2)! });
    };
    let scene = apply(reduceScene(emptyScene, { type: 'unit/add', unit: base }), [0, 3, 6]);
    const middle = unitContacts(scene.units[0]!, undefined).find((contact) => Math.abs(contact.position[0] - 3) < 0.01)!;
    scene = reduceScene(scene, { type: 'batch', commands: deleteCommands(scene.units[0]!, [middle.id]) });
    expect(unitContacts(scene.units[0]!, undefined).map((contact) => Math.round(contact.position[0]))).toEqual([0, 6]);
    scene = apply(scene, [0.2, 3.2, 6.2]);
    expect(unitContacts(scene.units[0]!, undefined).map((contact) => Math.round(contact.position[0]))).toEqual([0, 6]);
  });
});
