import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../core/analysis/types';
import type { GeneratedSupportMesh, SupportContact } from '../core/supports/mesh';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import type { ZoneStamp } from '../core/supports/zones';
import { buildSupportMesh as oracle } from '../../scripts/test-support/ts-oracle/support-builder/mesh';
import { buildSupportMesh } from './rustSupports';

/*
 * The production build (Rust, with the host's zone / landing-rule decisions) against the TS builder
 * it replaced (oracle), through the same options: rule 7 (indices, tags, dropped lists identical,
 * positions within 1e-5 mm) on the cases the Rust ABI alone cannot see: no-support zones, landing
 * rules, tips-only previews, trees blocked by either, and an Auto Tree Safe Distance.
 */

type V = [number, number, number];

function boxes(...list: [V, V][]): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [[x0, y0, z0], [x1, y1, z1]] of list) {
    const base = positions.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) positions.push(x!, y!, z!);
    for (const face of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) {
      indices.push(base + face[0]!, base + face[1]!, base + face[2]!, base + face[0]!, base + face[2]!, base + face[3]!);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const paint = (center: V, radius = 1, normal: V = [0, 1, 0]): ZoneStamp => ({ center, radius, normal, kind: 'paint' });

type Options = { mode?: 'preview' | 'export'; model?: TriangleMesh; labelText?: string; zones?: ZoneStamp[]; landingAllowed?: (hit: { faceIndex?: number }) => boolean };

function same(contacts: SupportContact[], settings: LiveSupportSettings, options: Options): GeneratedSupportMesh {
  const ts = oracle(contacts, settings, options as never);
  const rust = buildSupportMesh(contacts, settings, options as never);
  expect(Array.from(rust.indices)).toEqual(Array.from(ts.indices));
  expect(rust.positions.length).toBe(ts.positions.length);
  const worst = ts.positions.reduce((m, v, i) => Math.max(m, Math.abs(v - rust.positions[i]!)), 0);
  expect(worst).toBeLessThan(1e-5);
  expect(rust.parts).toEqual(ts.parts);
  expect(rust.components.map((c) => c.part)).toEqual(ts.components.map((c) => c.part));
  expect(rust.components.map((c) => [c.contactId, c.start, c.count])).toEqual(ts.components.map((c) => [c.contactId, c.start, c.count]));
  expect(rust.dropped).toEqual(ts.dropped);
  expect(rust.droppedByZones).toEqual(ts.droppedByZones ?? []);
  return rust;
}

describe('production build against the TS oracle: a column landing in a zone or on a forbidden face', () => {
  const model = boxes([[-20, 5, -20], [20, 9, 20]], [[-5, 20, -5], [5, 24, 5]]);
  const base = { ...defaultSupportSettings, roofSeededModes: [], raftEnabled: false, neckLength: 4 } as LiveSupportSettings;
  const tilted: SupportContact = { id: 'auto-shelf', kind: 'face', position: [0, 20, 0], normal: [0.5, -Math.sqrt(3) / 2, 0] };
  const manual: SupportContact = { ...tilted, id: 'manual-shelf', origin: 'manual' };
  const deny = (landing: { faceIndex?: number }) => landing.faceIndex === undefined;

  it.each([
    ['no zone', {}, {}],
    ['zone at the real landing (preview)', { zones: [paint([0, 9, 0])] }, {}],
    ['zone at the predicted landing (preview)', { zones: [paint([2, 9, 0])] }, {}],
    ['zone at the real landing (export)', { zones: [paint([0, 9, 0])], mode: 'export' }, {}],
    ['low poly: zone at the predicted landing', { zones: [paint([2, 9, 0])] }, { lowPolyMode: true }],
    ['tips-only: zone', { zones: [paint([0, 9, 0])] }, { previewMode: 'ONLY_TIP' }],
    ['erase after paint', { zones: [paint([0, 9, 0]), { ...paint([0, 9, 0]), kind: 'erase' as const }] }, {}],
    ['wrong side', { zones: [paint([0, 9, 0], 1, [0, -1, 0])] }, {}],
    ['landing rule denies (low poly)', { landingAllowed: deny }, { lowPolyMode: true }],
    ['landing rule denies (tips-only)', { landingAllowed: deny }, { lowPolyMode: true, previewMode: 'ONLY_TIP' }],
    ['landing rule denies (export, remeshed landing)', { landingAllowed: deny, mode: 'export' }, {}],
    ['raft and label on', { labelText: 'B7' }, { raftEnabled: true }],
  ] as [string, Options, Partial<LiveSupportSettings>][])('%s', (_name, options, settings) => {
    same([tilted, { ...tilted, id: 'second', position: [6, 20, 0] }], { ...base, ...settings }, { model, ...options });
  });

  it('never drops a manual support', () => {
    const built = same([manual], base, { model, zones: [paint([0, 9, 0])] });
    expect(built.dropped).toEqual([]);
  });

  it('actually drops the zoned column (not a vacuous comparison)', () => {
    expect(same([tilted], base, { model, zones: [paint([0, 9, 0])] }).dropped).toEqual(['auto-shelf']);
  });
});

describe('production build against the TS oracle: Auto Trees blocked by a zone or a landing rule', () => {
  const model = boxes([[-12, 30, -12], [12, 34, 12]], [[-0.5, 5, -0.5], [0.5, 25, 0.5]]);
  const settings = { ...defaultSupportSettings, roofSeededModes: [], scatterAutoTree: true, lowPolyMode: true, raftEnabled: false } as LiveSupportSettings;
  const contacts: SupportContact[] = [-0.9, 0.9, 7.1, 8.9].map((x) => ({ id: `auto-${x}`, position: [x, 30, 0], normal: [0, -1, 0], origin: 'auto' }));

  it('a zone on the landing drops the tree members, as a preview and tips-only', () => {
    const zone = paint([0, 25, 0], 0.6);
    expect(same(contacts, settings, { model, zones: [zone] }).dropped).toEqual(['auto--0.9', 'auto-0.9']);
    same(contacts, { ...settings, previewMode: 'ONLY_TIP' }, { model, zones: [zone] });
  });

  it('a forbidden landing face drops the tree members', () => {
    const built = same(contacts, settings, { model, landingAllowed: (hit) => hit.faceIndex === undefined || hit.faceIndex > 11 });
    expect(built.dropped.length).toBeGreaterThan(0);
  });

  it('the remeshed export builds and drops the same', () => {
    same(contacts, { ...settings, lowPolyMode: false }, { model, mode: 'export', zones: [paint([0, 25, 0], 0.6)] });
  });

  it('Safe Distance uses the host layout and matches', () => {
    same(contacts, { ...settings, scatterSafeDistance: 0.5, scatterMergeDistance: 5 }, { model, mode: 'export' });
  });
});

describe('production build: empty input and no model', () => {
  it('an empty contact list builds an empty mesh without touching the engine', () => {
    const built = buildSupportMesh([], defaultSupportSettings);
    expect(built.indices.length).toBe(0);
    expect(built.dropped).toEqual([]);
  });

  it('builds without a model like the oracle (raft from the column feet)', () => {
    const contacts: SupportContact[] = [0, 3, 6].map((x) => ({ id: `c${x}`, position: [x, 12, 0], normal: [0, -1, 0] }));
    same(contacts, { ...defaultSupportSettings, roofSeededModes: [] }, { labelText: 'A' });
  });
});
