import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import type { SupportPoint, TriangleMesh } from '../core/analysis/types';
import type { ZoneStamp } from '../core/supports/zones';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import { deserializeScene, emptyScene, identityTransform, reduceScene, serializeScene, type PrintScene, type PrintUnit } from './project';

const source: TriangleMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

const contact: SupportPoint = {
  id: 'contact-a',
  regionId: 0,
  position: [0, 0, 0],
  normal: [0, 0, 1],
  source: 'interior',
};

const unitA: PrintUnit = {
  id: 'unit-a',
  name: 'Unit A',
  source,
  transform: identityTransform,
  settings: { preset: 'CUSTOM' },
  placement: { points: [contact], regions: [], contactPositions: new Float32Array([0, 0, 0]), contactNormals: new Float32Array([0, 0, 1]) },
  supports: { kind: 'support-mesh', data: { pillars: 1 } },
  manual: [],
  deleted: [],
  zones: [],
  contactSettings: {},
};

describe('reduceScene', () => {
  it('adds an ordered unit without changing its source mesh', () => {
    const next = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });

    expect(next.units).toHaveLength(1);
    expect(next.units[0]).toMatchObject({ id: 'unit-a', source: unitA.source, supports: unitA.supports });
    expect(next.units[0].source).not.toBe(unitA.source);
    expect(Array.from(next.units[0].source.positions)).toEqual(Array.from(unitA.source.positions));
  });

  it('owns copied source mesh data after adding a unit', () => {
    const imported: TriangleMesh = { positions: new Float32Array(source.positions), indices: new Uint32Array(source.indices) };
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, source: imported } });

    imported.positions[0] = 99;
    imported.indices[0] = 2;
    expect(Array.from(scene.units[0].source.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(scene.units[0].source.indices)).toEqual([0, 1, 2]);
  });

  it('keeps a handed-over (owned) mesh as is, so heavy imports are not copied', () => {
    const imported: TriangleMesh = { positions: new Float32Array(source.positions), indices: new Uint32Array(source.indices) };
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, source: imported }, owned: true });
    expect(scene.units[0].source).toBe(imported);
    expect(() => reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, source: { positions: [0] as never, indices: new Uint32Array(0) } }, owned: true })).toThrow(TypeError);
  });

  it('removes only derived supports and preserves the source model', () => {
    const scene: PrintScene = { ...emptyScene, units: [unitA] };
    const next = reduceScene(scene, { type: 'supports/remove', unitId: 'unit-a' });

    expect(next.units[0].source).toBe(scene.units[0].source);
    expect(next.units[0].supports).toBeUndefined();
    expect(next.units[0].placement).toBeUndefined();
    expect(next.units[0].manual).toEqual([]);
  });

  it('updates selection, transform, settings, manual contacts, and removals immutably', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, supports: undefined, placement: undefined } });
    const selected = reduceScene(scene, { type: 'selection/set', unitIds: ['unit-a'], activeUnitId: 'unit-a' });
    const transformed = reduceScene(selected, { type: 'transform/set', unitId: 'unit-a', transform: { position: [1, 2, 3], rotation: [0, 1, 0] } });
    const configured = reduceScene(transformed, { type: 'settings/set', unitId: 'unit-a', settings: { preset: 'LIGHT' } });
    const edited = reduceScene(configured, { type: 'manual/add', unitId: 'unit-a', point: contact });
    const suppressed = reduceScene(edited, { type: 'deletion/add', unitId: 'unit-a', pointIds: ['auto-a'] });

    expect(scene.selectedUnitIds).toEqual([]);
    expect(suppressed).toMatchObject({ selectedUnitIds: ['unit-a'], activeUnitId: 'unit-a' });
    expect(suppressed.units[0]).toMatchObject({
      transform: { position: [1, 2, 3], rotation: [0, 1, 0] },
      settings: { preset: 'LIGHT' },
      manual: [contact],
      deleted: ['auto-a'],
    });
    expect(suppressed.units[0]).not.toBe(scene.units[0]);
  });

  it('records exact deletions once and clears them with manual edits', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });
    const deleted = reduceScene(scene, { type: 'deletion/add', unitId: 'unit-a', pointIds: ['auto-a', 'auto-b', 'auto-a'] });
    expect(deleted.units[0]!.deleted).toEqual(['auto-a', 'auto-b']);
    expect(reduceScene(deleted, { type: 'supports/clear-manual', unitId: 'unit-a' }).units[0]!.deleted).toEqual([]);
  });

  it('appends zone stamps in order, clears them, and keeps them through clear-manual', () => {
    const a: ZoneStamp = { center: [0, 0, 0], radius: 1, normal: [0, 1, 0], kind: 'paint' };
    const b: ZoneStamp = { center: [1, 0, 0], radius: 1, normal: [0, 1, 0], kind: 'erase' };
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });
    const one = reduceScene(scene, { type: 'zones/add', unitId: 'unit-a', stamps: [a] });
    const two = reduceScene(one, { type: 'zones/add', unitId: 'unit-a', stamps: [b] });
    expect(two.units[0]!.zones).toEqual([a, b]);
    expect(reduceScene(two, { type: 'supports/clear-manual', unitId: 'unit-a' }).units[0]!.zones).toEqual([a, b]);
    expect(reduceScene(two, { type: 'zones/clear', unitId: 'unit-a' }).units[0]!.zones).toEqual([]);
  });

  it('keeps an accepted dental policy and its ordered editable stamps through serialization', () => {
    const dental: DentalPolicy = {
      profileId: 'reference-aligner',
      rim: {
        boundaryKind: 'lower-edge-loop',
        points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        openingDirection: [0, -1, 0], centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1],
        visibilityMask: new Uint8Array([1, 0, 1, 1]), visibilityResolution: 2, visibilityMin: [-1, -1], visibilityMax: [1, 1],
      },
      stamps: [],
    };
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });
    const accepted = reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: dental });
    const edited = reduceScene(accepted, { type: 'dental/stamps/add', unitId: 'unit-a', stamps: [{ center: [0, 0, 0], radius: 1, normal: [0, -1, 0], kind: 'allow' }] });

    expect(edited.units[0]!.dental).toEqual({ ...dental, stamps: [{ center: [0, 0, 0], radius: 1, normal: [0, -1, 0], kind: 'allow' }] });
    expect(edited.units[0]!.dental!.rim.visibilityMask).not.toBe(dental.rim.visibilityMask);
    expect(deserializeScene(serializeScene(edited))).toEqual(edited);
    expect(reduceScene(edited, { type: 'dental/clear', unitId: 'unit-a' }).units[0]!.dental).toBeUndefined();
  });

  it('round-trips the exact two-contour face mask and refuses a mask for another mesh', () => {
    const rim = {
      boundaryKind: 'projection-fallback' as const, points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      openingDirection: [0, -1, 0] as [number, number, number], centroid: [0, 0, 0] as [number, number, number],
      tangent: [1, 0, 0] as [number, number, number], bitangent: [0, 0, 1] as [number, number, number],
      visibilityMask: new Uint8Array([1, 0, 1, 1]), visibilityResolution: 2,
      visibilityMin: [-1, -1] as [number, number], visibilityMax: [1, 1] as [number, number],
    };
    const policy: Extract<DentalPolicy, { kind: 'two-contour' }> = { kind: 'two-contour', profileId: 'reference-aligner', rim, stamps: [],
      structure: { treeEnabled: false, bracesEnabled: true },
      tuning: { positionMm: 0.7, stripWidthMm: 0.4, density: 1.5 }, region: {
      kind: 'proposal', allowedFaces: new Uint8Array([1]), contactFaces: new Uint8Array([1]),
      contacts: [{ face: 0, rim: 'outer', position: [0, 0, 0], normal: [0, -1, 0], distanceAlongContour: 0.5, distanceFromContour: 0.2 }],
      outerEdges: new Uint32Array([0, 1, 1, 2, 2, 0]),
      outerRidgeEdges: new Uint32Array([0, 1, 1, 2]), outerConnectorEdges: new Uint32Array([2, 0]),
      openingEdges: new Uint32Array([0, 2, 2, 1, 1, 0]), diagnostics: { regionFaces: [1, 0], connectorLengths: [1, 1] },
    } };
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });
    const withPolicy = reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy });
    expect(withPolicy.units[0]!.dental).toEqual(policy);
    expect(withPolicy.units[0]!.dental?.kind === 'two-contour' && withPolicy.units[0]!.dental.region.contactFaces)
      .not.toBe(policy.region.contactFaces);
    expect(deserializeScene(serializeScene(withPolicy))).toEqual(withPolicy);
    expect(() => reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: { ...policy,
      region: { ...policy.region, allowedFaces: new Uint8Array([1, 0]) } } })).toThrow();
    expect(() => reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: { ...policy,
      region: { ...policy.region, contactFaces: new Uint8Array([1, 0]) } } })).toThrow();
    expect(() => reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: { ...policy,
      region: { ...policy.region, contacts: [{ ...policy.region.contacts![0]!, rim: 'sideways' as 'outer' }] } } })).toThrow('dental contact rim');
    expect(() => reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: { ...policy,
      tuning: { positionMm: 0.2, stripWidthMm: 0, density: 1 } } })).toThrow('Invalid dental strip');
    // Older projects may still list provisional gap alternates: checked, then dropped (the policy offers its own).
    const withOldAlternates = { ...policy, gapAlternateIds: ['auto-1_2_3'] } as DentalPolicy;
    expect(reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: withOldAlternates }).units[0]!.dental).toEqual(policy);
    expect(() => reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: { ...policy,
      gapAlternateIds: [42 as unknown as string] } as DentalPolicy })).toThrow('dental alternate IDs');
    // A project without an aligner profile was made with profile #1; an unknown one is refused.
    const { profileId: _profile, ...unnamed } = policy;
    expect(reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: unnamed as DentalPolicy }).units[0]!.dental?.profileId).toBe('reference-aligner');
    expect(() => reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: { ...policy, profileId: 'retired' } })).toThrow('unknown aligner profile');
    expect(() => reduceScene(scene, { type: 'dental/set', unitId: 'unit-a', policy: { ...policy,
      structure: { treeEnabled: 1 as unknown as boolean, bracesEnabled: true } } })).toThrow('dental structure');
  });

  it('treats empty zone adds and clearing no zones as no-ops', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });
    expect(reduceScene(scene, { type: 'zones/add', unitId: 'unit-a', stamps: [] })).toBe(scene);
    expect(reduceScene(scene, { type: 'zones/clear', unitId: 'unit-a' })).toBe(scene);
  });

  it('normalizes a unit without zones to an empty list', () => {
    const { zones: _zones, ...legacy } = unitA;
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: legacy as PrintUnit });
    expect(scene.units[0]!.zones).toEqual([]);
  });

  it('normalizes a unit saved before manual edits existed (no manual or deleted lists)', () => {
    const { manual: _manual, deleted: _deleted, zones: _zones, ...legacy } = unitA;
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: legacy as PrintUnit });
    expect(scene.units[0]).toMatchObject({ manual: [], deleted: [], zones: [] });
  });

  it('re-keys a project saved with turned-frame automatic ids, and its removals with it', () => {
    const at = (id: string, x: number): SupportPoint => ({ ...contact, id, position: [x, -5, 0] });
    const legacy: PrintUnit = {
      ...unitA,
      placement: { ...unitA.placement!, points: [at('auto-0_500_-300', 3), at('auto-0_500_-600', 6)] },
      deleted: ['auto-0_500_-300', 'auto-9_9_9'],
    };
    const scene = deserializeScene(serializeScene(reduceScene(emptyScene, { type: 'unit/add', unit: legacy })));
    expect(scene.units[0]!.placement!.points.map((point) => point.id)).toEqual(['auto-300_-500_0', 'auto-600_-500_0']);
    expect(scene.units[0]!.deleted).toEqual(['auto-300_-500_0', 'auto-9_9_9']);
    expect(deserializeScene(serializeScene(scene)).units[0]).toEqual(scene.units[0]);
  });

  it('keeps hiding a removal saved before the spots moved, matched once on load', () => {
    const at = (id: string, x: number): SupportPoint => ({ ...contact, id, position: [x, -5, 0] });
    const moved: PrintUnit = {
      ...unitA,
      settings: { scatterSpacing: 2 },
      placement: { ...unitA.placement!, points: [at('auto-310_-500_0', 3.1), at('auto-600_-500_0', 6)] },
      deleted: ['auto-300_-500_0'],
    };
    const scene = deserializeScene(serializeScene(reduceScene(emptyScene, { type: 'unit/add', unit: moved })));
    expect(scene.units[0]!.deleted).toEqual(['auto-310_-500_0']);
    expect(deserializeScene(serializeScene(scene)).units[0]).toEqual(scene.units[0]);
  });

  it('migrates retired suppression markers into exact deleted ids on load, once', () => {
    const at = (id: string, x: number): SupportPoint => ({ ...contact, id, position: [x, -5, 0] });
    const old = {
      ...unitA,
      settings: { eraseRadius: 1.5 },
      placement: { ...unitA.placement!, points: [at('auto-0_-500_0', 0), at('auto-100_-500_0', 1), at('auto-400_-500_0', 4)] },
      manual: [{ ...at('manual-a', 0.5), id: 'manual-a' }],
      suppressed: ['auto-0_-500_0'],
    } as PrintUnit;
    const scene = deserializeScene(serializeScene(reduceScene(emptyScene, { type: 'unit/add', unit: old })));
    const unit = scene.units[0]! as PrintUnit & { suppressed?: unknown };
    expect(unit.suppressed).toBeUndefined();
    expect(unit.deleted).toEqual(['auto-0_-500_0', 'auto-100_-500_0']);
    expect(unit.manual.map((point) => point.id)).toEqual(['manual-a']);
    expect(deserializeScene(serializeScene(scene)).units[0]).toEqual(unit);
  });

  it('rejects runtime objects from settings and support payloads while retaining JSON-safe scenes', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, supports: undefined, placement: undefined } });

    expect(() => reduceScene(scene, { type: 'settings/set', unitId: 'unit-a', settings: { preview: new Object3D() as never } })).toThrow('JSON-safe');
    expect(() => reduceScene(scene, { type: 'supports/set', unitId: 'unit-a', supports: { kind: 'support-mesh', data: { preview: new Object3D() as never } } })).toThrow('JSON-safe');
    expect(() => reduceScene(scene, { type: 'supports/set', unitId: 'unit-a', supports: { kind: new Object3D() as never, data: {} } })).toThrow('support mesh kind');

    const safe = reduceScene(scene, { type: 'settings/set', unitId: 'unit-a', settings: { labels: ['a', true, null], depth: 2 } });
    expect(JSON.parse(JSON.stringify(safe))).toBeTruthy();
  });

  it('clones and validates placement and manual contacts at reducer boundaries', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, supports: undefined, placement: undefined } });
    const placement = { ...unitA.placement!, points: [{ ...contact, position: [...contact.position] as [number, number, number] }] };
    const withPlacement = reduceScene(scene, { type: 'supports/set', unitId: 'unit-a', placement, supports: unitA.supports });
    const manual = { ...contact, position: [...contact.position] as [number, number, number] };
    const withManual = reduceScene(withPlacement, { type: 'manual/add', unitId: 'unit-a', point: manual });

    placement.points[0].position[0] = 99;
    placement.contactPositions[0] = 99;
    manual.position[0] = 88;
    expect(withPlacement.units[0].placement!.points[0].position[0]).toBe(0);
    expect(withPlacement.units[0].placement!.contactPositions[0]).toBe(0);
    expect(withManual.units[0].manual[0].position[0]).toBe(0);
    expect(() => reduceScene(scene, { type: 'supports/set', unitId: 'unit-a', placement: { ...placement, points: [{ ...contact, position: new Object3D() as never }] } })).toThrow('JSON-safe');
    expect(() => reduceScene(scene, { type: 'manual/add', unitId: 'unit-a', point: { ...contact, normal: new Object3D() as never } })).toThrow('JSON-safe');
  });

  describe('per-support settings', () => {
    const manual: SupportPoint = { ...contact, id: 'manual-b' };
    const withSupports = () => reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, manual: [manual] } });
    const own = (scene: PrintScene) => scene.units[0]!.contactSettings;

    it('adding a support creates no override', () => {
      const scene = reduceScene(withSupports(), { type: 'manual/add', unitId: 'unit-a', point: { ...contact, id: 'manual-c' } });
      expect(own(scene)).toEqual({});
    });

    it('sets keys on many supports in one command and merges later keys', () => {
      const set = reduceScene(withSupports(), { type: 'contactSettings/set', unitId: 'unit-a', contactIds: ['contact-a', 'manual-b'], patch: { pointDiameter: 0.6 } });
      const more = reduceScene(set, { type: 'contactSettings/set', unitId: 'unit-a', contactIds: ['manual-b'], patch: { neckLength: 4 } });
      expect(own(more)).toEqual({ 'contact-a': { pointDiameter: 0.6 }, 'manual-b': { pointDiameter: 0.6, neckLength: 4 } });
    });

    it('keeps only shape keys, valid choices and clamped lengths, and ignores ids that name no support', () => {
      const patch = { pointDiameter: 0.01, contactShape: 'CUBE', pillarDiameter: 3, tipSection: 'CROSS' } as never;
      const set = reduceScene(withSupports(), { type: 'contactSettings/set', unitId: 'unit-a', contactIds: ['contact-a', 'auto-gone'], patch });
      expect(own(set)).toEqual({ 'contact-a': { pointDiameter: 0.05, tipSection: 'CROSS' } });
      const scene = withSupports();
      expect(reduceScene(scene, { type: 'contactSettings/set', unitId: 'unit-a', contactIds: ['contact-a'], patch: { pillarDiameter: 3 } as never })).toBe(scene);
    });

    it('reset, deleting the support, removing a manual one and Clear manual edits all drop the override', () => {
      const set = reduceScene(withSupports(), { type: 'contactSettings/set', unitId: 'unit-a', contactIds: ['contact-a', 'manual-b'], patch: { baseDiameter: 4 } });
      expect(Object.keys(own(reduceScene(set, { type: 'contactSettings/reset', unitId: 'unit-a', contactIds: ['contact-a'] })))).toEqual(['manual-b']);
      expect(Object.keys(own(reduceScene(set, { type: 'deletion/add', unitId: 'unit-a', pointIds: ['contact-a'] })))).toEqual(['manual-b']);
      expect(Object.keys(own(reduceScene(set, { type: 'manual/remove', unitId: 'unit-a', pointId: 'manual-b' })))).toEqual(['contact-a']);
      expect(own(reduceScene(set, { type: 'supports/clear-manual', unitId: 'unit-a' }))).toEqual({});
      expect(reduceScene(set, { type: 'contactSettings/reset', unitId: 'unit-a', contactIds: ['auto-gone'] })).toBe(set);
    });

    it('round-trips through the project file, and a project from before them loads with none', () => {
      const set = reduceScene(withSupports(), { type: 'contactSettings/set', unitId: 'unit-a', contactIds: ['manual-b'], patch: { contactShape: 'SPHERE', touchDiameter: 1.2 } });
      expect(own(deserializeScene(serializeScene(set)))).toEqual({ 'manual-b': { contactShape: 'SPHERE', touchDiameter: 1.2 } });
      const { contactSettings: _contactSettings, ...legacy } = unitA;
      expect(own(reduceScene(emptyScene, { type: 'unit/add', unit: legacy as PrintUnit }))).toEqual({});
    });
  });

  it('faithfully round-trips a populated scene through JSON', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });

    expect(deserializeScene(serializeScene(scene))).toEqual(scene);
    expect(deserializeScene(serializeScene(scene)).units[0].supports!.kind).toBe('support-mesh');
  });

  it('clears manual edits, removes units, and applies batches atomically', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, manual: [contact], deleted: ['auto-a'] } });
    const cleared = reduceScene(scene, { type: 'supports/clear-manual', unitId: 'unit-a' });
    expect(cleared.units[0]).toMatchObject({ manual: [], deleted: [] });
    expect(cleared.units[0].placement).toBeDefined();

    const both = reduceScene(emptyScene, { type: 'batch', commands: [
      { type: 'unit/add', unit: unitA },
      { type: 'unit/add', unit: { ...unitA, id: 'unit-b' } },
      { type: 'selection/set', unitIds: ['unit-a', 'unit-b'], activeUnitId: 'unit-b' },
    ] });
    expect(both.units.map((unit) => unit.id)).toEqual(['unit-a', 'unit-b']);

    const removed = reduceScene(both, { type: 'unit/remove', unitId: 'unit-b' });
    expect(removed.units.map((unit) => unit.id)).toEqual(['unit-a']);
    expect(removed.selectedUnitIds).toEqual(['unit-a']);
    expect(removed.activeUnitId).toBeUndefined();
    expect(reduceScene(both, { type: 'batch', commands: [] })).toBe(both);
  });
});
