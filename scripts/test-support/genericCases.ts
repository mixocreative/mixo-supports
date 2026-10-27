import type { PlacementSettings, SupportPoint } from '../../src/core/analysis/types';
import { defaultSupportSettings, toPlacementSettings, updateSetting, type LiveSupportSettings } from '../../src/core/supports/settings';
import { approxArray } from './golden';

/*
 * Inputs of src/supports/genericParity.test.ts, shared with the one-off oracle recorder (git history, 13aef9a)
 * that stored the TS placement's results in scripts/fixtures/golden/generic/.
 */

const base: LiveSupportSettings = { ...defaultSupportSettings, roofSeededModes: [] };

export const settingsVariants: [string, PlacementSettings][] = [
  ['default', toPlacementSettings(base)],
  ['ridge 30', toPlacementSettings(updateSetting(base, 'scatterRidgeAngle', 30))],
  ['reinforce off, ridge 45', toPlacementSettings(updateSetting(updateSetting(base, 'reinforceOverhangEdges', false), 'scatterRidgeAngle', 45))],
  ['reinforce off, ridge 30', toPlacementSettings(updateSetting(updateSetting(base, 'reinforceOverhangEdges', false), 'scatterRidgeAngle', 30))],
  ['no islands', toPlacementSettings(updateSetting(base, 'scatterIslands', false))],
  ['no downward faces', toPlacementSettings(updateSetting(base, 'scatterFacingDown', false))],
  ['spacing 1.5, angle 60', toPlacementSettings(updateSetting(updateSetting(base, 'scatterSpacing', 1.5), 'scatterAngle', 60))],
];

/** IDs, sources and regions exact; positions and normals sampled within tolerance (every point: step 1). */
export function placementSnapshot(placed: { points: readonly SupportPoint[]; regions: unknown }) {
  return {
    ids: placed.points.map((p) => p.id),
    sources: placed.points.map((p) => p.source),
    regions: placed.regions,
    positions: approxArray(placed.points.flatMap((p) => p.position), 1),
    normals: approxArray(placed.points.flatMap((p) => p.normal), 1),
  };
}

export const points = (ids: [string, number][]): SupportPoint[] => ids.map(([id, x]) => ({ id, regionId: -1, position: [x, 1, 0], normal: [0, -1, 0], source: 'interior' }));

export const bookkeeping = {
  positions: [[0.005, -0.005, 1.234], [-0.0051, 2.5, 10], [-1e-9, 0.994999, 123.456789]] as [number, number, number][],
  single: [3.145, 0, -2.718] as [number, number, number],
  fresh: points([['auto-110_100_0', 1.1], ['auto-500_100_0', 5], ['auto-505_100_0', 5.05], ['auto-900_100_0', 9]]),
  deleted: ['auto-100_100_0', 'auto-500_100_0', 'auto-1200_100_0', 'auto-503_100_0'],
  overrides: { 'auto-505_100_0': { neckLength: 2 }, 'manual-1': { neckLength: 3 }, 'auto-7000_100_0': { neckLength: 5 }, 'auto-108_100_0': { neckLength: 4 } } as Record<string, { neckLength: number }>,
  manualIds: ['manual-1'],
  markers: ['auto-120_100_0', 'auto-900_100_0'],
  stale: points([['auto-1_1_1', 1.1], ['manual-2', 2], ['auto-500_100_0', 5]]),
};

interface Impl {
  positionIds(positions: readonly [number, number, number][]): string[];
  positionId(position: [number, number, number]): string;
  remapDeleted(deleted: string[], points: SupportPoint[], radius: number): string[];
  rekeyHandWork(deleted: string[], overrides: Record<string, { neckLength: number }>, manual: Set<string>, points: SupportPoint[], radius: number): unknown;
  hidingRemovals(auto: SupportPoint[], deleted: string[]): Set<string>;
  contactsHiddenByMarkers(auto: SupportPoint[], markers: string[], radius: number): string[];
  rekeyPoints(points: SupportPoint[]): { points: SupportPoint[]; ids: Map<string, string> };
}

const plainOf = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_k, item) => (item instanceof Set ? [...item] : item instanceof Map ? [...item] : item)));

/** What the ID and manual-edit bookkeeping returns for the fixed inputs above (one implementation at a time). */
export function bookkeepingSnapshot(impl: Impl) {
  const b = bookkeeping;
  const rekeyed = impl.rekeyPoints(b.stale);
  return plainOf({
    ids: impl.positionIds(b.positions),
    single: impl.positionId(b.single),
    remap: impl.remapDeleted(b.deleted, b.fresh, 0.5),
    rekey: impl.rekeyHandWork(b.deleted, b.overrides, new Set(b.manualIds), b.fresh, 0.5),
    hiding: impl.hidingRemovals(b.fresh, b.deleted),
    markers: impl.contactsHiddenByMarkers(b.fresh, b.markers, 0.4),
    rekeyedIds: rekeyed.points.map((p) => p.id),
    idMap: rekeyed.ids,
  });
}
