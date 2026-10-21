import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import type { SupportPoint, TriangleMesh } from '../analysis/types';
import type { ZoneStamp } from '../supports/zones';
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
  suppressed: [],
  deleted: [],
  zones: [],
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

  it('removes only derived supports and preserves the source model', () => {
    const scene: PrintScene = { ...emptyScene, units: [unitA] };
    const next = reduceScene(scene, { type: 'supports/remove', unitId: 'unit-a' });

    expect(next.units[0].source).toBe(scene.units[0].source);
    expect(next.units[0].supports).toBeUndefined();
    expect(next.units[0].placement).toBeUndefined();
    expect(next.units[0].manual).toEqual([]);
  });

  it('updates selection, transform, settings, manual contacts, and suppressions immutably', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, supports: undefined, placement: undefined } });
    const selected = reduceScene(scene, { type: 'selection/set', unitIds: ['unit-a'], activeUnitId: 'unit-a' });
    const transformed = reduceScene(selected, { type: 'transform/set', unitId: 'unit-a', transform: { position: [1, 2, 3], rotation: [0, 1, 0] } });
    const configured = reduceScene(transformed, { type: 'settings/set', unitId: 'unit-a', settings: { preset: 'LIGHT' } });
    const edited = reduceScene(configured, { type: 'manual/add', unitId: 'unit-a', point: contact });
    const suppressed = reduceScene(edited, { type: 'suppression/add', unitId: 'unit-a', pointId: 'auto-a' });

    expect(scene.selectedUnitIds).toEqual([]);
    expect(suppressed).toMatchObject({ selectedUnitIds: ['unit-a'], activeUnitId: 'unit-a' });
    expect(suppressed.units[0]).toMatchObject({
      transform: { position: [1, 2, 3], rotation: [0, 1, 0] },
      settings: { preset: 'LIGHT' },
      manual: [contact],
      suppressed: ['auto-a'],
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

  it('faithfully round-trips a populated scene through JSON', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });

    expect(deserializeScene(serializeScene(scene))).toEqual(scene);
    expect(deserializeScene(serializeScene(scene)).units[0].supports!.kind).toBe('support-mesh');
  });

  it('clears manual edits, removes units, and applies batches atomically', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, manual: [contact], suppressed: ['auto-a'] } });
    const cleared = reduceScene(scene, { type: 'supports/clear-manual', unitId: 'unit-a' });
    expect(cleared.units[0]).toMatchObject({ manual: [], suppressed: [] });
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
