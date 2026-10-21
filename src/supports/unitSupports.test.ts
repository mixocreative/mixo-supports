import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../core/analysis/types';
import { identityTransform, type PrintUnit } from '../state/project';
import { applyTransform } from '../state/transform';
import { meshBounds } from '../core/supports/mesh';
import { defaultSupportSettings } from '../core/supports/settings';
import { resolveSettings, unitContacts, unitRemovedCount, unitSupportMesh } from './unitSupports';

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
  suppressed: ['auto-1'],
  deleted: [],
  zones: [],
};

describe('unit supports', () => {
  it('hides automatic contacts inside a no-support zone but keeps manual ones', () => {
    const zoned: PrintUnit = {
      ...unit,
      suppressed: [],
      manual: [point('manual-a', 0)],
      zones: [{ center: [0, -5, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' }],
    };
    expect(unitContacts(zoned).map((contact) => contact.id)).toEqual(['auto-1', 'manual-a']);
  });

  it('computes the contacts once per unit object and hands out a read-only list', () => {
    const first = unitContacts(unit);
    expect(unitContacts(unit)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    // A changed unit is a new object: its own list.
    const zoned: PrintUnit = { ...unit, zones: [{ center: [0, -5, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' }] };
    expect(unitContacts(zoned)).not.toBe(first);
    expect(unitContacts(zoned).map((contact) => contact.id)).toEqual(['manual-a']);
  });

  it('counts only the removals that hide a contact', () => {
    expect(unitRemovedCount(unit)).toBe(1);
    // A suppression of a spot that is gone and a deletion made before any placement hide nothing.
    expect(unitRemovedCount({ ...unit, suppressed: ['auto-1', 'auto-9999_9999_9999'] })).toBe(1);
    expect(unitRemovedCount({ ...unit, placement: undefined, deleted: ['auto-0'] })).toBe(0);
  });

  it('merges settings over defaults and composes contacts', () => {
    expect(resolveSettings({ preset: 'HEAVY', touchDiameter: 1 })).toMatchObject({ preset: 'HEAVY', touchDiameter: 1, raftEnabled: true });
    expect(unitContacts(unit).map((contact) => contact.id)).toEqual(['auto-0', 'manual-a']);
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
    const { meshBounds } = await import('../core/supports/mesh');
    const { applyTransform } = await import('../state/transform');
    const { unitLowestY } = await import('./unitSupports');
    const positions = new Float32Array(300).map((_, k) => Math.sin(k * 12.9898) * 20.123);
    const unit = { source: { positions, indices: new Uint32Array([0, 1, 2]) }, transform: { position: [3.3, 7.77, -1.5] as [number, number, number], rotation: [0.4, -1.1, 0.25] as [number, number, number] } } as never;
    expect(unitLowestY(unit)).toBe(meshBounds(applyTransform((unit as { source: never }).source, (unit as { transform: never }).transform)).min[1]);
  });
});
