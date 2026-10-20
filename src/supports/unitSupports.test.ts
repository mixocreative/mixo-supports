import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../analysis/types';
import { identityTransform, type PrintUnit } from '../state/project';
import { applyTransform } from '../state/transform';
import { meshBounds } from './mesh';
import { defaultSupportSettings } from './settings';
import { resolveSettings, unitContacts, unitSupportMesh } from './unitSupports';

const source: TriangleMesh = {
  positions: new Float32Array([-5, -5, -5, 5, -5, -5, 5, -5, 5, -5, -5, 5]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};
const point = (id: string, x: number): SupportPoint => ({ id, regionId: 0, position: [x, -5, 0], normal: [0, -1, 0], source: 'interior' });
const generated = { position: [0, 10, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
const unit: PrintUnit = {
  id: 'unit-a', name: 'A', source, transform: generated, settings: { ...defaultSupportSettings },
  placement: { points: [point('auto-0', 0), point('auto-1', 3)], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() },
  supports: { kind: 'live', data: { transform: generated } },
  manual: [point('manual-a', -3)],
  suppressed: ['auto-1'],
};

describe('unit supports', () => {
  it('merges settings over defaults and composes contacts', () => {
    expect(resolveSettings({ preset: 'HEAVY', touchDiameter: 1 })).toMatchObject({ preset: 'HEAVY', touchDiameter: 1, raftEnabled: true });
    expect(unitContacts(unit).map((contact) => contact.id)).toEqual(['auto-0', 'manual-a']);
  });

  it('builds supports in unit space that reach the plate at the generation transform', () => {
    const mesh = unitSupportMesh(unit, 0);
    const world = meshBounds(applyTransform(mesh, unit.transform));
    expect(world.min[1]).toBeCloseTo(0);
    expect(world.max[1]).toBeGreaterThan(5);
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
