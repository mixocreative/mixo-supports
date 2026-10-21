import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import mushroomContacts from '../../tools/blender-parity/mushroom_contacts.json';
import { generatePlacement } from '../core/analysis/placement';
import { geometryToMesh } from '../state/import';
import { buildSupportMesh } from '../core/supports/mesh';
import { defaultSupportSettings, toPlacementSettings } from '../core/supports/settings';

/**
 * Reference numbers measured from Resin UV (Blender 5.2, mixo.support_generate, Light
 * preset, 2 mm spacing) on the same mushroom: a 20x20x4 mm cap over a 4x4x10 mm stem,
 * lifted 5 mm. Geometry Nodes output is random-seeded, so parity is checked by counts
 * and profile, not vertex identity.
 */
const BLENDER = {
  contacts: { total: 100, cap: 92, stem: 8 },
  // By scatter class: Resin UV edge anchors, island minima (vertical necks), Poisson field
  // (positions in tools/blender-parity/mushroom_contacts.json).
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
  // The reference was made with SLASG's Contact Ø sphere (edge inset = its radius + 0.05).
  const settings = { ...defaultSupportSettings, contactShape: 'SPHERE' as const, scatterAngle: 45, roofSeededModes: [] }; // the Blender reference ran at 45 degrees
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

  it('matches each scatter stream: edge anchors and Poisson point for point, minima within a voxel', () => {
    // Blender's contacts (Blender axes) by class, from the same model and settings.
    const blender = (mushroomContacts as [string, number, number[]][]).map(([kind, , [x, y, z]]) => ({ kind, position: [x!, z!, -y!] }));
    const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    const ours = (sources: string[]) => placement.points.filter((point) => sources.includes(point.source)).map((point) => point.position);
    const theirs = (kind: string) => blender.filter((contact) => contact.kind === kind).map((contact) => contact.position);
    expect(ours(['physical-boundary', 'sharp-ridge']).length).toBe(BLENDER.classes.edge);
    // Poisson runs on the same remesh in the same triangle order with Blender's RNG.
    const poisson = ours(['interior']);
    expect(poisson.length).toBe(BLENDER.classes.poisson);
    for (const point of theirs('face')) expect(Math.min(...poisson.map((p) => near(p, point)))).toBeLessThan(0.02);
    // Minima: bit for bit (see blenderMinima.test.ts): the same 38 points.
    const minima = ours(['island']);
    expect(minima).toHaveLength(BLENDER.classes.minima);
    for (const point of theirs('vertical')) expect(Math.min(...minima.map((p) => near(p, point)))).toBeLessThan(1e-4);
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
