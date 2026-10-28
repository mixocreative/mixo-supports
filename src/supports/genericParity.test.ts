import { describe, expect, it } from 'vitest';
import type { SupportPoint } from '../core/analysis/types';
import { GOLDEN_FIXTURES } from '../goldens/fixtures';
import { expectGolden } from '../../scripts/test-support/golden';
import { bookkeeping, bookkeepingSnapshot, placementSnapshot, points, settingsVariants } from '../../scripts/test-support/genericCases';
import { goldenName } from '../../scripts/test-support/supportParityHarness';
import type { ZoneStamp } from '../core/supports/zones';
import { zonedAt } from './zoneCheck';
import { applyTransform } from '../state/transform';
import { contactsHiddenByMarkers, hidingRemovals, positionId, positionIds, rekeyHandWork, rekeyPoints, remapDeleted } from './contactEdits';
import { placeGeneric } from './genericPlacement';
import { jobContacts } from './genericPolicy';

/*
 * U5: the Rust generic policy (placement, deterministic contact IDs, composition with the manual
 * edits and zones, ID bookkeeping) against the results of the TS placement it replaced, recorded in
 * scripts/fixtures/golden/generic/ (U9; regenerate with UPDATE_GOLDENS=1, see scripts/test-support/golden.ts).
 * Rule 7: IDs, sources, regions identical; positions and normals within 1e-5 mm.
 */

describe('Rust placement against the recorded TS placement on the golden fixtures', () => {
  let compared = 0;
  let vertical = 0;
  let ridge = 0;
  for (const fixture of GOLDEN_FIXTURES) {
    for (const [label, settings] of settingsVariants) {
      it(`${fixture.name}: ${label}`, () => {
        const turned = applyTransform(fixture.mesh, { position: [0, 0, 0], rotation: [...fixture.rotation] });
        const rust = placeGeneric(turned, settings);
        expectGolden(goldenName(`${fixture.name}.${label}`, 'generic'), placementSnapshot(rust));
        compared += rust.points.length;
        vertical += rust.points.filter((p) => p.source === 'island').length;
        ridge += rust.points.filter((p) => p.source === 'sharp-ridge' || p.source === 'physical-boundary').length;
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

describe('contact IDs and the manual-edit bookkeeping against the recorded oracle results', () => {
  it('IDs round half up like Math.round, with the sign kept; removals, hand work and markers follow a fresh placement as recorded', () => {
    expectGolden('generic/bookkeeping', bookkeepingSnapshot({ positionIds, positionId, remapDeleted, rekeyHandWork, hidingRemovals, contactsHiddenByMarkers, rekeyPoints } as never));
  });

  it('the policy composes contacts like the recorded oracle: deleted out, zoned automatic out, manual kept, classes by source', () => {
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
    // Recorded oracle composition: deleted out, zoned automatic out (the zone sits on auto-400, the manual one stays).
    expect(contacts.map((c) => c.id)).toEqual(['auto-200_100_0', 'auto-600_100_0', 'manual-a']);
    expect(zonedAt(zones, [4, 1, 0], [0, -1, 0])).toBe(true);
    expect(contacts.map((c) => c.kind)).toEqual(['vertical', 'edge', 'face']);
    expect(contacts.map((c) => c.origin)).toEqual(['auto', 'auto', 'manual']);
  });
});

const sources = import.meta.glob<string>(['../workers/geometryClient.ts', './genericPolicy.ts', './contactEdits.ts', './genericPlacement.ts', './supportBuildWasm.ts', './supportEngine.ts', './generateSupports.ts', './checkSupports.ts'], { query: '?raw', import: 'default', eager: true });

describe('browser engine registration', () => {
  it('geometryClient hands the adapters every call they use (the browser build lists its exports by name)', () => {
    const client = sources['../workers/geometryClient.ts']!;
    const adapters = Object.entries(sources).filter(([file]) => file.startsWith('./')).map(([, text]) => text).join(' ');
    const calls = [...adapters.matchAll(/^  ([a-z][a-z_]+)\(/gm)].map((m) => m[1]!).filter((name) => name.includes('_') && !/^(take|set|add)_/.test(name) && !['generic_place', 'load_mesh', 'island_reason',
      // GeometrySession methods (the class is registered below), not free exports.
      'load_placed', 'release_mesh', 'dental_policy', 'generic_policy'].includes(name));
    expect(calls.length).toBeGreaterThan(5);
    for (const name of new Set(calls)) expect(client, name).toContain(`${name}: typeof ${name}`);
    // Classes have no snake_case call name to find: name them (`generate` and the policies are session methods).
    for (const name of ['GeometrySession']) expect(client, name).toContain(`${name}: typeof ${name}`);
    for (const name of ['check_support_problems']) expect(calls).toContain(name);
  });
});
