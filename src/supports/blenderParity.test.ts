import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generatePlacement } from '../analysis/placement';
import { geometryToMesh } from '../state/import';
import { buildSupportMesh } from './mesh';
import { defaultSupportSettings, toPlacementSettings } from './settings';

/**
 * Reference numbers measured from Resin UV (Blender 5.2, mixo.support_generate, Light
 * preset, 2 mm spacing) on the same mushroom: a 20x20x4 mm cap over a 4x4x10 mm stem,
 * lifted 5 mm. Geometry Nodes output is random-seeded, so parity is checked by counts
 * and profile, not vertex identity.
 */
const BLENDER = {
  contacts: { total: 100, cap: 92, stem: 8 },
  // By scatter class: Resin UV edge anchors, island minima (vertical necks), Poisson field.
  classes: { edge: 40, minima: 38, poisson: 22 },
  // Raft reach along -x from the model centre at the default 16 voxels.
  raft: { bottom: 12.368, wallTop: 13.232 },
  triangles: 41649,
};

function mushroom() {
  const stem = new BoxGeometry(4, 10, 4).translate(0, 10, 0).toNonIndexed();
  const cap = new BoxGeometry(20, 4, 20).translate(0, 17, 0).toNonIndexed();
  return geometryToMesh(mergeGeometries([stem, cap]) as BufferGeometry);
}

describe('Blender parity (mushroom fixture)', () => {
  const settings = { ...defaultSupportSettings, roofSeededModes: [] };
  const model = mushroom();
  const placement = generatePlacement(model, toPlacementSettings(settings));
  const mesh = buildSupportMesh(placement.points, settings, { labelText: 'A', mode: 'export', model });

  it('places a similar number of contacts on each overhang', () => {
    const cap = placement.points.filter((point) => point.position[1] > 10).length;
    const stem = placement.points.length - cap;
    expect(placement.points.length).toBeGreaterThan(BLENDER.contacts.total * 0.8);
    expect(placement.points.length).toBeLessThan(BLENDER.contacts.total * 1.2);
    expect(Math.abs(cap - BLENDER.contacts.cap)).toBeLessThanOrEqual(BLENDER.contacts.cap * 0.2);
    expect(Math.abs(stem - BLENDER.contacts.stem)).toBeLessThanOrEqual(3);
  });

  it('matches each scatter stream: exact edge anchors, minima and Poisson in range', () => {
    const count = (sources: string[]) => placement.points.filter((point) => sources.includes(point.source)).length;
    expect(count(['physical-boundary', 'sharp-ridge'])).toBe(BLENDER.classes.edge);
    expect(Math.abs(count(['island']) - BLENDER.classes.minima)).toBeLessThanOrEqual(BLENDER.classes.minima * 0.25);
    expect(Math.abs(count(['interior']) - BLENDER.classes.poisson)).toBeLessThanOrEqual(BLENDER.classes.poisson * 0.25);
  });

  it('matches the raft footprint and outward-leaning rim', () => {
    const reach = (y: number) => {
      let value = 0;
      for (let offset = 0; offset < mesh.positions.length; offset += 3) {
        if (Math.abs(mesh.positions[offset + 1]! - y) < 0.011 && Math.abs(mesh.positions[offset + 2]!) < 3) value = Math.max(value, -mesh.positions[offset]!);
      }
      return value;
    };
    expect(Math.abs(reach(0) - BLENDER.raft.bottom)).toBeLessThan(0.25);
    expect(Math.abs(reach(settings.raftWallHeight) - BLENDER.raft.wallTop)).toBeLessThan(0.25);
    expect(reach(settings.raftWallHeight)).toBeGreaterThan(reach(0));
  });

  it('produces geometry of comparable size', () => {
    const triangles = mesh.indices.length / 3;
    expect(triangles).toBeGreaterThan(BLENDER.triangles * 0.6);
    expect(triangles).toBeLessThan(BLENDER.triangles * 1.6);
  });
});
