import type { TriangleMesh } from '../../src/core/analysis/types';
import type { SupportContact } from '../../src/core/supports/mesh';
import { defaultSupportSettings, type LiveSupportSettings } from '../../src/core/supports/settings';
import type { ZoneStamp } from '../../src/core/supports/zones';

/*
 * The cases of src/supports/rustSupports.test.ts: zones, landing rules (as a per-face predicate here, a mask in
 * production), tips-only previews, Auto Trees and Safe Distance. Shared by the test and by the one-off recorder
 * (scripts/golden/record-builder.ts) that stored the TS builder's results in scripts/fixtures/golden/rustSupports/.
 */

type V = [number, number, number];

export function boxes(...list: [V, V][]): TriangleMesh {
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

export const paint = (center: V, radius = 1, normal: V = [0, 1, 0]): ZoneStamp => ({ center, radius, normal, kind: 'paint' });

export type Options = { mode?: 'preview' | 'export'; model?: TriangleMesh; labelText?: string; zones?: ZoneStamp[]; landingAllowed?: (hit: { faceIndex?: number }) => boolean };
export interface Case { name: string; contacts: SupportContact[]; settings: LiveSupportSettings; options: Options }

const slabModel = boxes([[-20, 5, -20], [20, 9, 20]], [[-5, 20, -5], [5, 24, 5]]);
const slabBase = { ...defaultSupportSettings, roofSeededModes: [], raftEnabled: false, neckLength: 4 } as LiveSupportSettings;
export const tilted: SupportContact = { id: 'auto-shelf', kind: 'face', position: [0, 20, 0], normal: [0.5, -Math.sqrt(3) / 2, 0] };
export const manualShelf: SupportContact = { ...tilted, id: 'manual-shelf', origin: 'manual' };
const deny = (landing: { faceIndex?: number }) => landing.faceIndex === undefined;

const slabCases: [string, Options, Partial<LiveSupportSettings>][] = [
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
];

const treeModel = boxes([[-12, 30, -12], [12, 34, 12]], [[-0.5, 5, -0.5], [0.5, 25, 0.5]]);
const treeSettings = { ...defaultSupportSettings, roofSeededModes: [], scatterAutoTree: true, lowPolyMode: true, raftEnabled: false } as LiveSupportSettings;
const treeContacts: SupportContact[] = [-0.9, 0.9, 7.1, 8.9].map((x) => ({ id: `auto-${x}`, position: [x, 30, 0], normal: [0, -1, 0], origin: 'auto' }));

export const CASES: Case[] = [
  ...slabCases.map(([name, options, settings]): Case => ({ name: `slab ${name}`, contacts: [tilted, { ...tilted, id: 'second', position: [6, 20, 0] }], settings: { ...slabBase, ...settings }, options: { model: slabModel, ...options } })),
  { name: 'slab manual never dropped', contacts: [manualShelf], settings: slabBase, options: { model: slabModel, zones: [paint([0, 9, 0])] } },
  { name: 'slab zoned column drops', contacts: [tilted], settings: slabBase, options: { model: slabModel, zones: [paint([0, 9, 0])] } },
  { name: 'tree zone preview', contacts: treeContacts, settings: treeSettings, options: { model: treeModel, zones: [paint([0, 25, 0], 0.6)] } },
  { name: 'tree zone tips-only', contacts: treeContacts, settings: { ...treeSettings, previewMode: 'ONLY_TIP' }, options: { model: treeModel, zones: [paint([0, 25, 0], 0.6)] } },
  { name: 'tree forbidden face', contacts: treeContacts, settings: treeSettings, options: { model: treeModel, landingAllowed: (hit) => hit.faceIndex === undefined || hit.faceIndex > 11 } },
  { name: 'tree remeshed export', contacts: treeContacts, settings: { ...treeSettings, lowPolyMode: false }, options: { model: treeModel, mode: 'export', zones: [paint([0, 25, 0], 0.6)] } },
  { name: 'tree safe distance', contacts: treeContacts, settings: { ...treeSettings, scatterSafeDistance: 0.5, scatterMergeDistance: 5 }, options: { model: treeModel, mode: 'export' } },
  { name: 'no model', contacts: [0, 3, 6].map((x) => ({ id: `c${x}`, position: [x, 12, 0], normal: [0, -1, 0] } as SupportContact)), settings: { ...defaultSupportSettings, roofSeededModes: [] }, options: { labelText: 'A' } },
];
