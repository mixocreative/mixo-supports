import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import type { SupportPoint, TriangleMesh } from '../analysis/types';
import { emptyScene, identityTransform, reduceScene, type PrintScene, type PrintUnit } from './project';

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
};

describe('reduceScene', () => {
  it('adds an ordered unit without changing its source mesh', () => {
    const next = reduceScene(emptyScene, { type: 'unit/add', unit: unitA });

    expect(next.units).toHaveLength(1);
    expect(next.units[0]).toMatchObject({ id: 'unit-a', source: unitA.source, supports: unitA.supports });
    expect(next.units[0].source).toBe(unitA.source);
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

  it('rejects runtime objects from settings and support payloads while retaining JSON-safe scenes', () => {
    const scene = reduceScene(emptyScene, { type: 'unit/add', unit: { ...unitA, supports: undefined, placement: undefined } });

    expect(() => reduceScene(scene, { type: 'settings/set', unitId: 'unit-a', settings: { preview: new Object3D() as never } })).toThrow('JSON-safe');
    expect(() => reduceScene(scene, { type: 'supports/set', unitId: 'unit-a', supports: { kind: 'support-mesh', data: { preview: new Object3D() as never } } })).toThrow('JSON-safe');

    const safe = reduceScene(scene, { type: 'settings/set', unitId: 'unit-a', settings: { labels: ['a', true, null], depth: 2 } });
    expect(JSON.parse(JSON.stringify(safe))).toBeTruthy();
  });
});
