import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from './analysis/types';
import { jobContacts, type ContactInputs } from './jobs';
import { defaultSupportSettings, type LiveSupportSettings } from './supports/settings';

const point = (id: string, x: number, source: SupportPoint['source'] = 'interior'): SupportPoint => ({ id, regionId: 0, position: [x, 0, 0], normal: [0, -1, 0], source });
const settings = { ...defaultSupportSettings, roofSeededModes: [] } as LiveSupportSettings;
const inputs = (overrides: Partial<ContactInputs> = {}): ContactInputs => ({ points: [point('auto-0', 0), point('auto-1', 10, 'island')], manual: [point('manual-a', 20)], suppressed: [], deleted: [], zones: [], ...overrides });

describe('jobContacts', () => {
  it('lists automatic then manual contacts with their SLASG class; manual ones never join trees', () => {
    expect(jobContacts(inputs(), settings)).toEqual([
      { id: 'auto-0', position: [0, 0, 0], normal: [0, -1, 0], kind: 'face', tree: true },
      { id: 'auto-1', position: [10, 0, 0], normal: [0, -1, 0], kind: 'vertical', tree: true },
      { id: 'manual-a', position: [20, 0, 0], normal: [0, -1, 0], kind: 'face', tree: false },
    ]);
  });

  it('drops deleted contacts and automatic ones inside a no-support zone, never manual ones', () => {
    const zones = [{ center: [10, 0, 0] as [number, number, number], radius: 1, normal: [0, -1, 0] as [number, number, number], kind: 'paint' as const }, { center: [20, 0, 0] as [number, number, number], radius: 1, normal: [0, -1, 0] as [number, number, number], kind: 'paint' as const }];
    expect(jobContacts(inputs({ deleted: ['auto-0'], zones }), settings).map((contact) => contact.id)).toEqual(['manual-a']);
  });
});

describe('jobContacts: landing on a no-support zone', () => {
  type V = [number, number, number];
  /** Outward-facing axis-aligned boxes as one mesh. */
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
  // A slab (top at y = 9) with a shelf above it (underside at y = 20).
  const model = boxes([[-20, 5, -20], [20, 9, 20]], [[-5, 20, -5], [5, 24, 5]]);
  const under = (id: string, position: V): SupportPoint => ({ id, regionId: 0, position, normal: [0, -1, 0], source: 'interior' });
  const paint = (center: V, normal: V = [0, 1, 0]) => ({ center, radius: 3, normal, kind: 'paint' as const });
  const shelfInputs = (zones: ContactInputs['zones']): ContactInputs => ({
    // auto-shelf lands on the slab top under it; auto-slab (slab underside) lands on the plate.
    points: [under('auto-shelf', [0, 20, 0]), under('auto-slab', [15, 5, 0])],
    manual: [under('manual-shelf', [2, 20, 2])],
    suppressed: [], deleted: [], zones,
  });
  const ids = (zones: ContactInputs['zones'], frame = { position: [0, 0, 0] as V, rotation: [0, 0, 0] as V }) =>
    jobContacts(shelfInputs(zones), settings, { model, frame }).map((contact) => contact.id);

  it('drops an automatic support whose column lands inside a zone painted on the surface below; manual ones stay', () => {
    expect(ids([])).toEqual(['auto-shelf', 'auto-slab', 'manual-shelf']);
    expect(ids([paint([0, 9, 0])])).toEqual(['auto-slab', 'manual-shelf']);
  });

  it('keeps the same-side rule and erase: a zone on the far side, or erased again, drops nothing', () => {
    expect(ids([paint([0, 9, 0], [0, -1, 0])])).toEqual(['auto-shelf', 'auto-slab', 'manual-shelf']);
    expect(ids([paint([0, 9, 0]), { ...paint([0, 9, 0]), kind: 'erase' }])).toEqual(['auto-shelf', 'auto-slab', 'manual-shelf']);
    // A zone elsewhere on the slab top leaves the landing support alone.
    expect(ids([paint([12, 9, 12])])).toEqual(['auto-shelf', 'auto-slab', 'manual-shelf']);
  });

  it('casts in the frame the supports were generated at (unit moved on the plate)', () => {
    expect(ids([paint([0, 9, 0])], { position: [30, 2, -10], rotation: [0, 0, 0] })).toEqual(['auto-slab', 'manual-shelf']);
  });

  it('casts down the plate, not unit-local Y: a unit stood up 90 degrees about X', () => {
    // The same shelf over slab, built along local -Z; Rx(90°) maps local (x, y, z) to plate (x, -z, y).
    const standing = boxes([[-20, -20, -9], [20, 20, -5]], [[-5, -5, -24], [5, 5, -20]]);
    const point = (id: string, position: V): SupportPoint => ({ id, regionId: 0, position, normal: [0, 0, 1], source: 'interior' });
    const upright = { position: [0, 0, 0] as V, rotation: [Math.PI / 2, 0, 0] as V };
    const zones = [{ center: [0, 0, -9] as V, radius: 3, normal: [0, 0, -1] as V, kind: 'paint' as const }];
    const inputs: ContactInputs = { points: [point('auto-shelf', [0, 0, -20])], manual: [], suppressed: [], deleted: [], zones };
    expect(jobContacts(inputs, settings, { model: standing, frame: upright }).map((contact) => contact.id)).toEqual([]);
    // Lying flat (no rotation) the shelf is beside the slab, not over it: nothing lands in the zone.
    expect(jobContacts(inputs, settings, { model: standing, frame: { position: [0, 0, 0], rotation: [0, 0, 0] } }).map((contact) => contact.id)).toEqual(['auto-shelf']);
  });

  it('a stamp centred a little above the contact but reaching down over its landing still counts', () => {
    // A short drop: shelf underside at y = 12 over the slab top at y = 9; the stamp centre sits at y = 12.5 on a slope edge.
    const low = boxes([[-20, 5, -20], [20, 9, 20]], [[-5, 12, -5], [5, 16, 5]]);
    const inputs: ContactInputs = { points: [under('auto-low', [0, 12, 0])], manual: [], suppressed: [], deleted: [], zones: [{ center: [0, 12.5, 0], radius: 4, normal: [0, 1, 0], kind: 'paint' }] };
    expect(jobContacts(inputs, { ...settings, neckLength: 1 }, { model: low, frame: { position: [0, 0, 0], rotation: [0, 0, 0] } }).map((contact) => contact.id)).toEqual([]);
  });

  it('without a model (no supports generated) only the contact itself is tested', () => {
    expect(jobContacts(shelfInputs([paint([0, 9, 0])]), settings).map((contact) => contact.id)).toEqual(['auto-shelf', 'auto-slab', 'manual-shelf']);
  });
});
