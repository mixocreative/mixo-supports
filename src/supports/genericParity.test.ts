import { describe, expect, it } from 'vitest';
import { generatePlacement, composeContacts, hidingRemovals as oracleHiding, rekeyHandWork as oracleRekey, remapDeleted as oracleRemap, contactsHiddenByMarkers as oracleMarkers, rekeyPoints as oracleRekeyPoints, positionId as oracleId } from '../../scripts/test-support/ts-oracle/placement/placement';
import type { PlacementSettings, SupportPoint } from '../core/analysis/types';
import { GOLDEN_FIXTURES } from '../goldens/fixtures';
import { defaultSupportSettings, toPlacementSettings, updateSetting, type LiveSupportSettings } from '../core/supports/settings';
import { zonedAt, type ZoneStamp } from '../core/supports/zones';
import { applyTransform } from '../state/transform';
import { contactsHiddenByMarkers, hidingRemovals, positionId, positionIds, rekeyHandWork, rekeyPoints, remapDeleted } from './contactEdits';
import { placeGeneric } from './genericPlacement';
import { jobContacts } from './genericPolicy';

/*
 * U5: the Rust generic policy (placement, deterministic contact IDs, composition with the manual
 * edits and zones, ID bookkeeping) against the TS oracle (scripts/test-support/ts-oracle/placement).
 * Rule 7: IDs, sources, regions identical; positions and normals within 1e-5 mm.
 */

const base: LiveSupportSettings = { ...defaultSupportSettings, roofSeededModes: [] };

const settingsVariants: [string, PlacementSettings][] = [
  ['default', toPlacementSettings(base)],
  ['ridge 30', toPlacementSettings(updateSetting(base, 'scatterRidgeAngle', 30))],
  ['reinforce off, ridge 45', toPlacementSettings(updateSetting(updateSetting(base, 'reinforceOverhangEdges', false), 'scatterRidgeAngle', 45))],
  ['reinforce off, ridge 30', toPlacementSettings(updateSetting(updateSetting(base, 'reinforceOverhangEdges', false), 'scatterRidgeAngle', 30))],
  ['no islands', toPlacementSettings(updateSetting(base, 'scatterIslands', false))],
  ['no downward faces', toPlacementSettings(updateSetting(base, 'scatterFacingDown', false))],
  ['spacing 1.5, angle 60', toPlacementSettings(updateSetting(updateSetting(base, 'scatterSpacing', 1.5), 'scatterAngle', 60))],
];

const worst = (a: readonly number[], b: readonly number[]) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0);

describe('Rust placement against the TS oracle on the golden fixtures', () => {
  let compared = 0;
  let vertical = 0;
  let ridge = 0;
  for (const fixture of GOLDEN_FIXTURES) {
    for (const [label, settings] of settingsVariants) {
      it(`${fixture.name}: ${label}`, () => {
        const turned = applyTransform(fixture.mesh, { position: [0, 0, 0], rotation: [...fixture.rotation] });
        const ts = generatePlacement(turned, settings);
        const rust = placeGeneric(turned, settings);
        expect(rust.points.map((p) => p.id)).toEqual(ts.points.map((p) => p.id));
        expect(rust.points.map((p) => p.source)).toEqual(ts.points.map((p) => p.source));
        expect(rust.regions).toEqual(ts.regions);
        expect(worst(rust.points.flatMap((p) => p.position), ts.points.flatMap((p) => p.position))).toBeLessThan(1e-5);
        expect(worst(rust.points.flatMap((p) => p.normal), ts.points.flatMap((p) => p.normal))).toBeLessThan(1e-5);
        compared += ts.points.length;
        vertical += ts.points.filter((p) => p.source === 'island').length;
        ridge += ts.points.filter((p) => p.source === 'sharp-ridge' || p.source === 'physical-boundary').length;
      }, 120_000);
    }
  }

  it('compared real streams, not an empty set', () => {
    expect(compared).toBeGreaterThan(300);
    expect(vertical).toBeGreaterThan(0);
    expect(ridge).toBeGreaterThan(0);
  });

  it('rejects out-of-range settings with a typed error', () => {
    const turned = GOLDEN_FIXTURES[0]!.mesh;
    expect(() => placeGeneric(turned, { ...settingsVariants[0]![1], spacing: 0 })).toThrowError(expect.objectContaining({ code: 'SETTING_OUT_OF_RANGE' }));
  });
});

describe('contact IDs and the manual-edit bookkeeping against the oracle', () => {
  const points = (ids: [string, number][]): SupportPoint[] => ids.map(([id, x]) => ({ id, regionId: -1, position: [x, 1, 0], normal: [0, -1, 0], source: 'interior' }));

  it('IDs round half up like Math.round, with the sign kept', () => {
    const positions: [number, number, number][] = [[0.005, -0.005, 1.234], [-0.0051, 2.5, 10], [-1e-9, 0.994999, 123.456789]];
    expect(positionIds(positions)).toEqual(positions.map((p) => oracleId(p)));
    expect(positionId([3.145, 0, -2.718])).toBe(oracleId([3.145, 0, -2.718]));
  });

  it('removals follow a fresh placement as the oracle matches them', () => {
    const fresh = points([['auto-110_100_0', 1.1], ['auto-500_100_0', 5], ['auto-505_100_0', 5.05], ['auto-900_100_0', 9]]);
    const deleted = ['auto-100_100_0', 'auto-500_100_0', 'auto-1200_100_0', 'auto-503_100_0'];
    expect(remapDeleted(deleted, fresh, 0.5)).toEqual(oracleRemap(deleted, fresh, 0.5));
    const overrides = { 'auto-505_100_0': { neckLength: 2 }, 'manual-1': { neckLength: 3 }, 'auto-7000_100_0': { neckLength: 5 }, 'auto-108_100_0': { neckLength: 4 } };
    const manual = new Set(['manual-1']);
    expect(rekeyHandWork(deleted, overrides, manual, fresh, 0.5)).toEqual(oracleRekey(deleted, overrides, manual, fresh, 0.5));
    expect(hidingRemovals(fresh, deleted)).toEqual(oracleHiding(fresh, deleted));
    expect(contactsHiddenByMarkers(fresh, ['auto-120_100_0', 'auto-900_100_0'], 0.4)).toEqual(oracleMarkers(fresh, ['auto-120_100_0', 'auto-900_100_0'], 0.4));
    const stale = points([['auto-1_1_1', 1.1], ['manual-2', 2], ['auto-500_100_0', 5]]);
    const { points: rekeyed, ids } = rekeyPoints(stale);
    const expected = oracleRekeyPoints(stale);
    expect(rekeyed.map((p) => p.id)).toEqual(expected.points.map((p) => p.id));
    expect([...ids]).toEqual([...expected.ids]);
  });

  it('the policy composes contacts like the oracle: deleted out, zoned automatic out, manual kept, classes by source', () => {
    const auto: SupportPoint[] = [
      { id: 'auto-0_100_0', regionId: -1, position: [0, 1, 0], normal: [0, -1, 0], source: 'interior' },
      { id: 'auto-200_100_0', regionId: -1, position: [2, 1, 0], normal: [0, -1, 0], source: 'island' },
      { id: 'auto-400_100_0', regionId: -1, position: [4, 1, 0], normal: [0, -1, 0], source: 'sharp-ridge' },
      { id: 'auto-600_100_0', regionId: -1, position: [6, 1, 0], normal: [0, -1, 0], source: 'physical-boundary' },
    ];
    const manual: SupportPoint[] = [{ id: 'manual-a', regionId: -1, position: [4, 1, 0], normal: [0, -1, 0], source: 'interior' }];
    const zones: ZoneStamp[] = [{ center: [4, 1, 0], normal: [0, -1, 0], radius: 0.5, kind: 'paint' }];
    const deleted = ['auto-0_100_0'];
    const contacts = jobContacts({ points: auto, manual, deleted, zones, contactSettings: {} });
    const expected = composeContacts(auto, manual, deleted).filter((p) => p.id.startsWith('manual-') || !zonedAt(zones, p.position, p.normal));
    expect(contacts.map((c) => c.id)).toEqual(expected.map((p) => p.id));
    expect(contacts.map((c) => c.kind)).toEqual(['vertical', 'edge', 'face']);
    expect(contacts.map((c) => c.origin)).toEqual(['auto', 'auto', 'manual']);
  });
});

const sources = import.meta.glob<string>(['../workers/geometryClient.ts', './genericPolicy.ts', './contactEdits.ts', './genericPlacement.ts', './supportBuildWasm.ts', './supportEngine.ts', './generateSupports.ts', './checkSupports.ts'], { query: '?raw', import: 'default', eager: true });

describe('browser engine registration', () => {
  it('geometryClient hands the adapters every call they use (the browser build lists its exports by name)', () => {
    const client = sources['../workers/geometryClient.ts']!;
    const adapters = Object.entries(sources).filter(([file]) => file.startsWith('./')).map(([, text]) => text).join(' ');
    const calls = [...adapters.matchAll(/^  ([a-z][a-z_]+)\(/gm)].map((m) => m[1]!).filter((name) => name.includes('_') && !/^(take|set|add)_/.test(name) && !['build_supports', 'generic_place', 'cast_down', 'load_mesh', 'support_settings_layout', 'island_reason'].includes(name));
    expect(calls.length).toBeGreaterThan(5);
    for (const name of new Set(calls)) expect(client, name).toContain(`${name}: typeof ${name}`);
    // Classes have no snake_case call name to find: name them (U7 `generate` reads its policy from PolicyData).
    for (const name of ['PolicyData', 'GeometrySession']) expect(client, name).toContain(`${name}: typeof ${name}`);
    for (const name of ['check_support_problems', 'contour_perimeter']) expect(calls).toContain(name);
  });
});
