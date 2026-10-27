import { describe, expect, it } from 'vitest';
import reference from '../../../../tools/blender-parity/reference.json';
import { raftOutline } from './raft';
import { buildRoofCage } from './roof';
import { defaultSupportSettings, type LiveSupportSettings } from '../../../../src/core/supports/settings';

/**
 * Roof and Cage against Resin UV (tools/blender-parity/probe.py cases roof_* and cage_*):
 * columns, cross bars, roof slab, radial and concentric brace plates, and cage rings.
 * Blender works Z-up; the web is Y-up: Blender (x, y, z) = web (x, -z, y).
 */
type Vec3 = [number, number, number];
interface Piece { n: number; min: Vec3; max: Vec3; rings?: [number, number, number, number][] }
interface RoofCase { settings: Record<string, number | boolean | string>; roof: Piece[] }

const KEYS: Record<string, keyof LiveSupportSettings> = {
  column_count: 'columnCount', column_diameter: 'columnDiameter', diagonal_enabled: 'diagonalEnabled', diagonal_diameter: 'diagonalDiameter',
  brace_concentric: 'braceConcentric', brace_thickness: 'braceThickness', brace_angle: 'braceAngle', storey_floor_thickness: 'storeyFloorThickness',
  storey_enclose_ceiling: 'storeyEncloseCeiling', roof_mode: 'roofMode', roof_gap: 'roofGap', cage_side_gap: 'cageSideGap', cage_top_gap: 'cageTopGap',
  cage_pitch: 'cagePitch', cage_ring_diameter: 'cageRingDiameter', raft_expand_width: 'raftExpandWidth', voxel_resolution: 'voxelResolution', lift_height: 'liftHeight',
};

const cases = Object.entries((reference as unknown as { cases: Record<string, RoofCase> }).cases).filter(([, c]) => c.roof && c.roof.length > 0);

describe.each(cases)('Blender %s', (_name, blender) => {
  const settings = { ...defaultSupportSettings, roofSeededModes: [] } as LiveSupportSettings;
  for (const [key, value] of Object.entries(blender.settings)) if (KEYS[key]) (settings as Record<string, unknown>)[KEYS[key]!] = value;
  if (settings.roofMode === 'CAGE') settings.braceConcentric = 0;
  const lift = settings.liftHeight;
  const spike = {
    positions: new Float32Array([0, lift, 0, -3, lift + 3, 3, 3, lift + 3, 3, 3, lift + 3, -3, -3, lift + 3, -3]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 1, 2, 3, 1, 3, 4]),
  };
  const expand = Math.max(settings.raftExpandWidth, settings.cageSideGap + settings.columnDiameter / 2);
  const outline = raftOutline(spike, expand, Math.max(64, settings.voxelResolution));
  const web = buildRoofCage(outline.raw, lift + 3, settings);
  const toBlender = ([x, y, z]: readonly number[]): Vec3 => [x!, -z!, y!];
  const near = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]!));

  // Classify Blender pieces by their tube radius / shape.
  const columns = blender.roof.filter((p) => p.rings && p.rings.length > 2 && Math.abs(p.rings[0]![3] - settings.columnDiameter / 2) < 0.02);
  const bars = blender.roof.filter((p) => p.n === 24 && p.rings && Math.abs(p.rings[0]![3] - settings.diagonalDiameter / 2) < 0.02);

  it('stands the same columns along the raft perimeter', () => {
    const webColumns = web.bars.filter((bar) => bar.part === 'column');
    expect(webColumns.length).toBe(columns.length);
    webColumns.forEach((bar, i) => {
      const from = toBlender(bar.from);
      const to = toBlender(bar.to);
      const ring = columns[i]!.rings!;
      expect(near(from.slice(0, 2), ring[0]!.slice(0, 2))).toBeLessThan(0.1);
      expect(Math.abs(to[2] - ring[ring.length - 1]![2])).toBeLessThan(0.1);
    });
  });

  it('places the same cross bars per band', () => {
    const webBars = web.bars.filter((bar) => bar.part === 'cross-bar').map((bar) => [toBlender(bar.from), toBlender(bar.to)]);
    expect(webBars.length).toBe(bars.length);
    for (const bar of bars) {
      const ends = [bar.rings![0]!.slice(0, 3), bar.rings![1]!.slice(0, 3)];
      expect(webBars.some(([a, b]) => near(a!, ends[0]!) < 0.15 && near(b!, ends[1]!) < 0.15), JSON.stringify(ends)).toBe(true);
    }
  });

  it('builds the roof slab, brace plates and cage rings with Blender extents', () => {
    if (settings.roofMode === 'CAGE') {
      const rings = blender.roof.filter((p) => p.n > 1000);
      expect(web.rings.length).toBe(rings.length);
      web.rings.forEach((ring, i) => {
        const xs = ring.points.map((p) => p[0]);
        expect(Math.abs(ring.points[0]![1] - (rings[i]!.min[2] + rings[i]!.max[2]) / 2)).toBeLessThan(1e-3);
        expect(Math.abs(Math.max(...xs) + ring.radius - rings[i]!.max[0])).toBeLessThan(0.12);
      });
      return;
    }
    const height = lift + 3 + settings.roofGap;
    if (settings.storeyEncloseCeiling) {
      const slab = blender.roof.find((p) => p.n === 2 * settings.columnCount && Math.abs(p.min[2] - height) < 1e-3)!;
      const roof = web.sweeps.find((sweep) => sweep.part === 'roof')!;
      const xs = roof.polygon.map((p) => p[0]);
      expect(Math.abs(Math.max(...xs) - slab.max[0])).toBeLessThan(0.12);
      expect(Math.abs(roof.polygon[0]![1] + roof.offset[1] - slab.max[2])).toBeLessThan(1e-3);
    }
    // Radial plates: one per column, same lowest point and top.
    const plates = blender.roof.filter((p) => p.n === 8 || p.n === 6);
    const webPlates = web.sweeps.filter((sweep) => sweep.part === 'roof-brace');
    expect(webPlates.length).toBe(plates.length);
    const lows = plates.map((p) => p.min[2]).sort((a, b) => a - b);
    const webLows = webPlates.map((sweep) => Math.min(...sweep.polygon.map((p) => p[1]))).sort((a, b) => a - b);
    lows.forEach((low, i) => expect(Math.abs(webLows[i]! - low)).toBeLessThan(0.12));
    expect(Math.max(...webPlates.flatMap((sweep) => sweep.polygon.map((p) => p[1])))).toBeCloseTo(Math.max(...plates.map((p) => p.max[2])), 3);
    // Concentric rings: same count and dip.
    const solidBands = blender.roof.filter((p) => p.n === 8 * settings.columnCount);
    expect(web.bands.length).toBe(solidBands.length);
    const dips = solidBands.map((p) => p.min[2]).sort((a, b) => a - b);
    const webDips = web.bands.map((band) => Math.min(...band.bottom.map((p) => p[1]))).sort((a, b) => a - b);
    dips.forEach((dip, i) => expect(Math.abs(webDips[i]! - dip)).toBeLessThan(0.12));
  });
});
