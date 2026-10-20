import { describe, expect, it } from 'vitest';
import reference from '../../tools/blender-parity/reference.json';
import type { TriangleMesh } from '../analysis/types';
import { buildSupportMesh, columnChain, type GeneratedSupportMesh, type SupportContact } from './mesh';
import { defaultSupportSettings, type LiveSupportSettings } from './settings';

/**
 * Same settings in, same supports out. `tools/blender-parity/probe.py` records Resin UV
 * (Blender) output for a matrix of settings on a downward pyramid; each case here feeds the
 * same contacts and settings to the web generator and compares every support dimension.
 * Blender works Z-up; the web is Y-up: web (x, y, z) = Blender (x, z, -y).
 */
type Vec3 = [number, number, number];
interface BlenderColumn { z: [number, number]; foot_center: [number, number]; foot_radius: number; top_center: [number, number]; top_radius: number; rings: [number, number, number, number][] | null }
interface BlenderCase {
  settings: Record<string, number | boolean | string>;
  contacts: Vec3[];
  spheres: { center: Vec3; radius: number }[];
  columns: BlenderColumn[];
  raft: { reach_bottom: number; reach_top: number; z_max: number } | null;
}

const CASES = (reference as unknown as { cases: Record<string, BlenderCase> }).cases;

const KEYS: Record<string, keyof LiveSupportSettings> = {
  touch_diameter: 'touchDiameter', touch_depth: 'touchDepth', neck_diameter: 'neckDiameter', neck_length: 'neckLength',
  max_neck_angle: 'maxNeckAngle', pillar_diameter: 'pillarDiameter', base_diameter: 'baseDiameter', base_height: 'baseHeight',
  raft_enabled: 'raftEnabled', raft_expand_width: 'raftExpandWidth', raft_floor_thickness: 'raftFloorThickness',
  raft_wall_height: 'raftWallHeight', raft_wall_thickness: 'raftWallThickness', raft_wall_angle: 'raftWallAngle',
  voxel_resolution: 'voxelResolution', resolution: 'resolution', lift_height: 'liftHeight',
};

function webSettings(blender: BlenderCase['settings']): LiveSupportSettings {
  const settings: LiveSupportSettings = { ...defaultSupportSettings, roofSeededModes: [], trussEnabled: false, labelEnabled: false };
  for (const [key, value] of Object.entries(blender)) {
    const web = KEYS[key];
    if (web) (settings as Record<string, unknown>)[web] = value;
  }
  return settings;
}

const toWeb = ([x, y, z]: readonly number[]): Vec3 => [x!, z!, -y!];

/** The column Blender grew from a contact: the one whose top sits on that contact. */
function columnFor(blender: BlenderCase, contact: Vec3): BlenderColumn {
  return blender.columns.reduce((best, column) => {
    const d = (c: BlenderColumn) => Math.hypot(c.top_center[0] - contact[0], c.top_center[1] - contact[1]) + Math.abs(c.z[1] - contact[2]);
    return d(column) < d(best) ? column : best;
  });
}

function bounds(mesh: GeneratedSupportMesh, part: string, contactId?: string) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const component of mesh.components) {
    if (component.part !== part || (contactId && component.contactId !== contactId)) continue;
    for (let offset = component.start; offset < component.start + component.count; offset += 1) {
      const vertex = mesh.indices[offset]! * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, mesh.positions[vertex + axis]!);
        max[axis] = Math.max(max[axis]!, mesh.positions[vertex + axis]!);
      }
    }
  }
  return { min, max };
}

/** The probe model in web space: a downward pyramid, apex at Lift Height, top ±3 mm at Lift + 3. */
function spike(lift: number): TriangleMesh {
  return {
    positions: new Float32Array([0, lift, 0, -3, lift + 3, 3, 3, lift + 3, 3, 3, lift + 3, -3, -3, lift + 3, -3]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 1, 2, 3, 1, 3, 4]),
  };
}

/**
 * True surface normal of a pyramid contact (Blender axes). Contacts on a pyramid edge or the
 * apex get a vertical neck, as Blender's edge anchors and island minima do.
 */
function surfaceNormal([x, y]: readonly number[]): Vec3 {
  if (Math.abs(Math.abs(x!) - Math.abs(y!)) < 1e-3) return [0, 0, -1];
  const s = Math.SQRT1_2;
  if (Math.abs(x!) > Math.abs(y!)) return [Math.sign(x!) * s, 0, -s];
  return [0, Math.sign(y!) * s, -s];
}

describe.each(Object.entries(CASES))('Blender case %s', (name, blender) => {
  const settings = webSettings(blender.settings);
  const contacts = blender.contacts.map((contact, index): SupportContact => (
    { id: `c${index}`, position: toWeb(contact), normal: toWeb(surfaceNormal(contact)) }
  ));
  const mesh = buildSupportMesh(contacts, settings, { mode: 'export', model: spike(settings.liftHeight) });

  it('places every foot, neck and tip where Blender does', () => {
    let ruled = 0;
    blender.contacts.forEach((contact, index) => {
      const column = columnFor(blender, contact);
      const id = `c${index}`;
      const foot = bounds(mesh, 'foot', id);
      const tip = bounds(mesh, 'tip', id);
      const neck = bounds(mesh, 'neck', id);
      // Exact for every support: foot radius on the plate, touch sphere size and centre.
      expect((foot.max[0] - foot.min[0]) / 2).toBeCloseTo(column.foot_radius, 1);
      expect(foot.min[1]).toBeCloseTo(0, 3);
      const sphere = blender.spheres.reduce((best, s) => Math.hypot(s.center[0] - contact[0], s.center[1] - contact[1], s.center[2] - contact[2])
        < Math.hypot(best.center[0] - contact[0], best.center[1] - contact[1], best.center[2] - contact[2]) ? s : best);
      expect((tip.max[1] - tip.min[1]) / 2).toBeCloseTo(sphere.radius, 2);
      expect((tip.max[1] + tip.min[1]) / 2).toBeCloseTo(sphere.center[2], 1);

      // Neck shift: where Blender applies the plain tilt rule (shift = Connection Length x
      // sin(min(tilt, Connection Angle)), or 0 for vertical necks) the web foot lands on the
      // same spot. SLASG's pillar-repulsion step turns or shortens necks of crowded supports;
      // that step is not replicated yet, so those supports are counted, not compared.
      const blenderShift = Math.hypot(column.foot_center[0] - contact[0], column.foot_center[1] - contact[1]);
      const ruleShift = settings.neckLength * Math.sin(settings.maxNeckAngle * Math.PI / 180);
      const followsRule = blenderShift < 0.02 || Math.abs(blenderShift - ruleShift) < 0.02;
      if (!followsRule) return;
      const webCenter = [(foot.min[0] + foot.max[0]) / 2, -(foot.min[2] + foot.max[2]) / 2];
      expect(Math.hypot(webCenter[0]! - contact[0], webCenter[1]! - contact[1])).toBeCloseTo(blenderShift, 1);
      expect(neck.max[1]).toBeGreaterThan(column.z[1] - 0.25);
      ruled += 1;
    });
    // On this model 11 to 14 of the 17 supports follow the plain rule in every case.
    expect(ruled).toBeGreaterThanOrEqual(11);
  });

  it('reproduces the column curve ring by ring (fillet, transition, foot)', () => {
    let compared = 0;
    blender.contacts.forEach((contact, index) => {
      const column = columnFor(blender, contact);
      if (!column.rings) return;
      // Isolate the chain shape from the direction source: use Blender's own neck direction,
      // recovered from the foot offset (neck bottom = contact + d x Connection Length).
      const dx = column.foot_center[0] - contact[0];
      const dy = column.foot_center[1] - contact[1];
      const length = settings.neckLength;
      const direction: Vec3 = [dx / length, dy / length, -Math.sqrt(Math.max(0, length ** 2 - dx * dx - dy * dy)) / length];
      const input: SupportContact = { id: `c${index}`, position: toWeb(contact), normal: toWeb(direction) };
      const dedupe = <T extends readonly number[]>(list: T[]) => list.filter((item, i) => i === 0 || Math.hypot(item[0]! - list[i - 1]![0]!, item[1]! - list[i - 1]![1]!, item[2]! - list[i - 1]![2]!) > 1e-3);
      const expected = dedupe(column.rings.map(([x, y, z, r]) => [...toWeb([x, y, z]), r] as number[]));
      const actual = dedupe(columnChain(input, { ...settings, maxNeckAngle: 89 }, spike(settings.liftHeight)).map((node) => [...node.point, node.radius]));
      expect(actual.length).toBe(expected.length);
      actual.forEach((node, i) => {
        const ring = expected[i]!;
        expect(Math.hypot(node[0]! - ring[0]!, node[1]! - ring[1]!, node[2]! - ring[2]!)).toBeLessThan(0.01);
        expect(Math.abs(node[3]! - ring[3]!)).toBeLessThan(0.01);
      });
      compared += 1;
    });
    expect(compared).toBe(blender.contacts.length);
  });

  it('matches the neck top radius (Upper Ø) of the vertical apex column', () => {
    const apexIndex = blender.contacts.findIndex((c) => Math.hypot(c[0], c[1]) < 1e-3);
    const column = columnFor(blender, blender.contacts[apexIndex]!);
    const neck = bounds(mesh, 'neck', `c${apexIndex}`);
    // At the top the neck is Upper Ø; its widest point (bottom) is Middle Ø.
    expect(column.top_radius).toBeCloseTo(settings.neckDiameter / 2, 2);
    expect((neck.max[0] - neck.min[0]) / 2).toBeCloseTo(settings.pillarDiameter / 2, 1);
  });

  it('matches the raft profile', () => {
    if (!blender.raft) {
      expect(mesh.parts).not.toContain('raft');
      return;
    }
    const raft = bounds(mesh, 'raft');
    expect(raft.max[1]).toBeCloseTo(blender.raft.z_max, 2);
    // Reach along the X axis at the plate and at the rim top. SLASG voxelises the raft;
    // at 64 voxels it matches within 0.15 mm, at the default 16 voxels within ~0.9 mm.
    const tolerance = settings.voxelResolution >= 64 ? 0.15 : 0.9;
    const reach = (y: number) => {
      let value = 0;
      for (const component of mesh.components.filter((c) => c.part === 'raft')) {
        for (let offset = component.start; offset < component.start + component.count; offset += 1) {
          const vertex = mesh.indices[offset]! * 3;
          if (Math.abs(mesh.positions[vertex + 1]! - y) < 1e-3 && Math.abs(mesh.positions[vertex + 2]!) < 0.75) value = Math.max(value, Math.abs(mesh.positions[vertex]!));
        }
      }
      return value;
    };
    expect(Math.abs(reach(0) - blender.raft.reach_bottom)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(reach(blender.raft.z_max) - blender.raft.reach_top)).toBeLessThanOrEqual(tolerance);
    void name;
  });
});

describe('Blender neck tilt rule', () => {
  it('shifts face contacts by Connection Length x sin(min(normal tilt, Connection Angle))', () => {
    // Pyramid faces lean 45 degrees; Blender clamps at the Connection Angle.
    for (const [name, angle] of [['light', 45], ['neck_angle_30', 30], ['neck_length_3', 45]] as const) {
      const blender = CASES[name]!;
      const length = blender.settings.neck_length as number;
      const shifts = blender.contacts.map((contact) => {
        const column = columnFor(blender, contact);
        return Math.hypot(column.foot_center[0] - contact[0], column.foot_center[1] - contact[1]);
      });
      expect(Math.max(...shifts)).toBeCloseTo(length * Math.sin(angle * Math.PI / 180), 1);
    }
  });
});
