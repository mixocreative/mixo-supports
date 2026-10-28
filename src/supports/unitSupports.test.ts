import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../core/analysis/types';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { identityTransform, type PrintUnit } from '../state/project';
import { applyTransform } from '../state/transform';
import { meshBounds } from '../core/supports/meshQuery';
import { defaultSupportSettings } from '../core/supports/settings';
import { jobContacts } from './genericPolicy';
import { dentalPlacementJobOf, hiddenByZones, PLACEMENT_KEYS, resolveSettings, supportJobOf, unitContacts, unitRemovedCount, unitSupportMesh } from './unitSupports';

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
  contactSettings: {},
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
    // The same unit and build answer from one working out; a different build is counted afresh.
    const build = { dropped: ['auto-1'] };
    expect(hiddenByZones(zoned, build)).toBe(2);
    expect(hiddenByZones(zoned, build)).toBe(2);
    expect(hiddenByZones(zoned, undefined)).toBe(1);
  });

  it('does not count dental landing rejections as no-support-zone removals', () => {
    const zoned: PrintUnit = { ...unit, deleted: [], manual: [], zones: [{ center: [0, -5, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' }] };
    expect(hiddenByZones(zoned, { dropped: ['auto-1'], droppedByZones: [] })).toBe(1);
  });

  it('never counts a manual support as hidden by zones, even one lying inside a zone', () => {
    const zoned: PrintUnit = { ...unit, deleted: [], manual: [point('manual-a', 0), point('manual-b', 0.5)], zones: [{ center: [0, -5, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' }] };
    expect(unitContacts(zoned, undefined).filter((contact) => contact.id.startsWith('manual-'))).toHaveLength(2);
    expect(hiddenByZones(zoned, undefined)).toBe(1);
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

  it('only makes a dental placement job after its support area was accepted', () => {
    expect(dentalPlacementJobOf(unit)).toBeUndefined();
    const dental: DentalPolicy = {
      profileId: 'reference-aligner',
      rim: {
        boundaryKind: 'lower-edge-loop', points: new Float32Array([0, -5, -1, 1, -5, -1, 0, -5, 1]),
        openingDirection: [0, -1, 0], centroid: [0, -5, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1],
        visibilityMask: new Uint8Array([1]), visibilityResolution: 1, visibilityMin: [-1, -1], visibilityMax: [1, 1],
      },
      stamps: [],
    };
    expect(dentalPlacementJobOf({ ...unit, dental })).toMatchObject({
      mesh: source,
      orientation: { position: [0, 0, 0], rotation: generated.rotation },
      dental,
    });
    expect(supportJobOf({ ...unit, dental }, 0).dental).toBe(dental);
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

describe('per-support settings in preview and export', () => {
  const customised: PrintUnit = { ...unit, contactSettings: { 'auto-0': { pointDiameter: 0.6, neckLength: 4 }, 'manual-a': { contactShape: 'SPHERE', touchDiameter: 1.2 } } };

  it('builds preview and export from the same contacts and the same per-support values', () => {
    const preview = supportJobOf(customised, 0, 'preview');
    const exported = supportJobOf(customised, 0, 'export');
    expect(exported.contacts).toEqual(preview.contacts);
    expect(jobContacts(exported.contacts).map((contact) => [contact.id, contact.shape])).toEqual([['auto-0', { pointDiameter: 0.6, neckLength: 4 }], ['manual-a', { contactShape: 'SPHERE', touchDiameter: 1.2 }]]);
  });

  it('gives identical support geometry in preview and export, different from the defaults', () => {
    const preview = unitSupportMesh(customised, 0, 'preview');
    const exported = unitSupportMesh(customised, 0, 'export');
    expect(Array.from(exported.positions)).toEqual(Array.from(preview.positions));
    expect(Array.from(exported.indices)).toEqual(Array.from(preview.indices));
    expect(Array.from(preview.positions)).not.toEqual(Array.from(unitSupportMesh(unit, 0, 'preview').positions));
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
    const commands = placementCommands(moved, requested, result, lift, 1.5)!.commands;
    expect(commands[0]).toEqual({ type: 'transform/set', unitId: 'unit-a', transform: { position: [30, 10, -4], rotation: [0, 0, 0] } });
    expect(commands[1]).toMatchObject({ type: 'supports/set', unitId: 'unit-a', supports: { kind: 'live', data: { transform: { position: [30, 10, -4], rotation: [0, 0, 0] } } } });
    // Lowest point (local y = -5) at the plate plus Lift Height.
    const low: PrintUnit = { ...unit, transform: { position: [30, 2, -4], rotation: [0, 0, 0] } };
    expect(placementCommands(low, requested, result, lift, 1.5)!.commands[0]).toMatchObject({ transform: { position: [30, 10, -4] } });
  });

  it('maps contacts back to unit-local space through the requested orientation', async () => {
    const { placementCommands } = await import('./unitSupports');
    const turned = { position: [0, 0, 0] as [number, number, number], rotation: [Math.PI, 0, 0] as [number, number, number] };
    const now: PrintUnit = { ...unit, transform: { position: [0, 10, 0], rotation: [Math.PI, 0, 0] } };
    const placed = { points: [{ ...point('auto-0', 2), position: [2, 5, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number] }], regions: [] };
    const set = placementCommands(now, turned, placed, lift, 1.5)!.commands[1] as { placement: { points: { position: number[]; normal: number[] }[] } };
    expect(set.placement.points[0]!.position.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([2, -5, 0]);
    expect(set.placement.points[0]!.normal.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 1, 0]);
  });

  it('applies nothing when the unit was rotated meanwhile (its contacts face the old way)', async () => {
    const { placementCommands } = await import('./unitSupports');
    const rotated: PrintUnit = { ...unit, transform: { position: [0, 10, 0], rotation: [0, 0.5, 0] } };
    expect(placementCommands(rotated, requested, result, lift, 1.5)).toBeUndefined();
  });
});

describe('liftCommands (a lift change raises the placed unit without placing it again)', () => {
  const placed = { ...unit, transform: { position: [30, 8, -4] as [number, number, number], rotation: [0, 0.3, 0] as [number, number, number] },
    supports: { kind: 'live', data: { transform: generated, placed: { ...Object.fromEntries(PLACEMENT_KEYS.map((key) => [key, defaultSupportSettings[key]])) } } } } as PrintUnit;

  it('moves the unit and the supports frame exactly where a placement landing would, and keeps the contacts', async () => {
    const { liftCommands, placementCommands, orientationOf, placementSignature } = await import('./unitSupports');
    const settings = { ...resolveSettings(placed.settings), liftHeight: 7.5 };
    const commands = liftCommands(placed, settings)!;
    const landing = placementCommands(placed, orientationOf(placed), placed.placement!, settings.liftHeight, 1.5, placementSignature(settings))!.commands;
    expect(commands[0]).toEqual(landing[0]);
    expect(commands[1]).toMatchObject({ type: 'supports/set', placement: placed.placement, supports: { kind: 'live', data: (landing[1] as { supports: { data: object } }).supports.data } });
  });

  it('is not used without placed supports or with another placement change pending', async () => {
    const { liftCommands } = await import('./unitSupports');
    const settings = resolveSettings(placed.settings);
    expect(liftCommands({ ...placed, supports: undefined }, settings)).toBeUndefined();
    expect(liftCommands(placed, { ...settings, scatterSpacing: settings.scatterSpacing + 1 })).toBeUndefined();
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
      return reduceScene(scene, { type: 'batch', commands: placementCommands(now, orientation, placed(xs), 5, spacing / 2)!.commands });
    };
    let scene = apply(reduceScene(emptyScene, { type: 'unit/add', unit: base }), [0, 3, 6]);
    const middle = unitContacts(scene.units[0]!, undefined).find((contact) => Math.abs(contact.position[0] - 3) < 0.01)!;
    scene = reduceScene(scene, { type: 'batch', commands: deleteCommands(scene.units[0]!, [middle.id]) });
    expect(unitContacts(scene.units[0]!, undefined).map((contact) => Math.round(contact.position[0]))).toEqual([0, 6]);
    scene = apply(scene, [0.2, 3.2, 6.2]);
    expect(unitContacts(scene.units[0]!, undefined).map((contact) => Math.round(contact.position[0]))).toEqual([0, 6]);

    // Per-support settings follow the same match, in the same batch; one with no neighbour left is dropped, not kept.
    const [first, last] = unitContacts(scene.units[0]!, undefined);
    scene = reduceScene(scene, { type: 'contactSettings/set', unitId: 'unit-a', contactIds: [first!.id, last!.id], patch: { neckLength: 4 } });
    const now = scene.units[0]!;
    const applied = placementCommands(now, orientation, placed([0.3, 3.3]), 5, spacing / 2)!;
    expect(applied.handWork.customised).toEqual({ kept: 1, reset: 1 });
    scene = reduceScene(scene, { type: 'batch', commands: applied.commands });
    const shaped = unitContacts(scene.units[0]!, undefined).filter((contact) => contact.shape).map((contact) => [Math.round(contact.position[0]), contact.shape]);
    expect(shaped).toEqual([[0, { neckLength: 4 }]]);
    expect(Object.keys(scene.units[0]!.contactSettings)).toHaveLength(1);
  });
});

describe('placementPending (a placement setting changed since the contacts were placed)', () => {
  const requested = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
  const result = { points: [point('auto-0', 0)], regions: [] };

  it('is set by a placement setting change and cleared by placing again', async () => {
    const { placementCommands, placementPending, placementSignature, resolveSettings } = await import('./unitSupports');
    const { reduceScene, emptyScene } = await import('../state/project');
    const place = (scene: ReturnType<typeof reduceScene>) => {
      const now = scene.units[0]!;
      const settings = resolveSettings(now.settings);
      return reduceScene(scene, { type: 'batch', commands: placementCommands(now, requested, result, settings.liftHeight, 1.5, placementSignature(settings))!.commands });
    };
    let scene = place(reduceScene(emptyScene, { type: 'unit/add', unit: { ...unit, placement: undefined, supports: undefined, manual: [], deleted: [] } }));
    expect(placementPending(scene.units[0]!)).toBe(false);
    const change = (key: string, value: number) => reduceScene(scene, { type: 'settings/set', unitId: 'unit-a', settings: { ...resolveSettings(scene.units[0]!.settings), [key]: value } as never });
    // A setting that does not move contacts leaves it as it was.
    expect(placementPending(change('neckDiameter', 9).units[0]!)).toBe(false);
    scene = change('scatterSpacing', resolveSettings(scene.units[0]!.settings).scatterSpacing + 1);
    expect(placementPending(scene.units[0]!)).toBe(true);
    scene = place(scene);
    expect(placementPending(scene.units[0]!)).toBe(false);
  });

  it('is not set for a unit with no recorded placement', async () => {
    const { placementPending } = await import('./unitSupports');
    expect(placementPending({ ...unit, supports: { kind: 'live', data: {} } })).toBe(false);
    expect(placementPending({ ...unit, supports: undefined })).toBe(false);
  });
});
