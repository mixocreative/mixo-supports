import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../core/analysis/types';
import { defaultSupportSettings } from '../core/supports/settings';
import { landedStatus } from '../editing/regenerate';
import { reduceScene, type PrintUnit } from '../state/project';
import { landPlacements } from './landing';
import { resolveSettings } from './unitSupports';

const source: TriangleMesh = {
  positions: new Float32Array([-5, -5, -5, 5, -5, -5, 5, -5, 5, -5, -5, 5, -5, 5, -5, 5, 5, -5, 5, 5, 5, -5, 5, 5]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]),
};
const point = (id: string, x: number): SupportPoint => ({ id, regionId: 0, position: [x, -5, 0], normal: [0, -1, 0], source: 'interior' });
const upright = { position: [0, 10, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
const unitOf = (id: string, supported: boolean): PrintUnit => ({
  id, name: id, source, transform: upright, settings: { ...defaultSupportSettings }, manual: [], deleted: [], zones: [], contactSettings: {},
  ...(supported ? { placement: { points: [point('old', 0)], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() }, supports: { kind: 'live', data: { transform: upright } } } : {}),
});
const finished = (unit: PrintUnit, xs: number[]) => ({
  unitId: unit.id, orientation: { position: [0, 0, 0] as [number, number, number], rotation: unit.transform.rotation }, settings: resolveSettings(unit.settings),
  result: { points: xs.map((x) => point(`p${x}`, x)), regions: [] },
});

describe('landPlacements (objects regenerated together land as one step)', () => {
  it('puts every object in one batch, so one Undo brings all of them back', () => {
    const a = unitOf('a', true);
    const b = unitOf('b', true);
    const { commands, landed, again } = landPlacements([a, b], [finished(a, [0, 3]), finished(b, [1])]);
    expect(again).toEqual([]);
    expect(landed.map((entry) => [entry.name, entry.placed])).toEqual([['a', 2], ['b', 1]]);
    const scene = commands.reduce(reduceScene, { units: [a, b], selectedUnitIds: [] });
    expect(scene.units.map((unit) => unit.placement?.points.length)).toEqual([2, 1]);
  });

  it('skips a unit that left, and asks to place again one that was rotated meanwhile', () => {
    const a = unitOf('a', true);
    const b = unitOf('b', true);
    const rotated = { ...b, transform: { ...b.transform, rotation: [0, 0.5, 0] as [number, number, number] } };
    const { commands, landed, again } = landPlacements([rotated], [finished(a, [0]), finished(b, [1])]);
    expect(commands).toEqual([]);
    expect(landed).toEqual([]);
    expect(again).toEqual([rotated]);
  });

  it('reports hand work only for a regeneration, not a first Generate', () => {
    const fresh = unitOf('c', false);
    expect(landPlacements([fresh], [finished(fresh, [0])]).landed[0]).not.toHaveProperty('report');
    const again = unitOf('d', true);
    expect(landPlacements([again], [finished(again, [0])]).landed[0]).toHaveProperty('report');
  });
});

describe('landedStatus', () => {
  const report = { added: 1, removed: 2, reset: 0, customisedKept: 0, customisedReset: 0 };

  it('reads as the single-object line for one object', () => {
    expect(landedStatus([{ name: 'A', placed: 4 }])).toEqual({ key: '{name}: {n} automatic contacts generated.', vars: { name: 'A', n: 4 } });
  });

  it('sums the hand work of several regenerated objects into one line', () => {
    expect(landedStatus([{ name: 'A', placed: 4, report }, { name: 'B', placed: 2, report }]).vars).toEqual({ n: 2, added: 2, removed: 4, reset: 0 });
    expect(landedStatus([{ name: 'A', placed: 4, report: { added: 0, removed: 0, reset: 0, customisedKept: 0, customisedReset: 0 } }, { name: 'B', placed: 2, report: { added: 0, removed: 0, reset: 0, customisedKept: 0, customisedReset: 0 } }])).toEqual({ key: 'Regenerated {n} objects.', vars: { n: 2 } });
    expect(landedStatus([{ name: 'A', placed: 4 }, { name: 'B', placed: 2, report }])).toEqual({ key: 'Generated supports for {n} objects.', vars: { n: 2 } });
  });
});
