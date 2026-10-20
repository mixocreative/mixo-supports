import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../analysis/types';
import { buildSupportMesh, contactAtTriangle, meshBounds, type GeneratedSupportMesh, type SupportContact } from './mesh';
import { defaultSupportSettings, setRoofMode, updateSetting, type LiveSupportSettings } from './settings';

const settings: LiveSupportSettings = { ...defaultSupportSettings, roofSeededModes: [] };
const contact: SupportContact = { id: 'auto-0', position: [0, 10, 0], normal: [0, -1, 0] };
const neighbour: SupportContact = { id: 'auto-1', position: [4, 10, 0], normal: [0, -1, 0] };

// A 10 mm cube whose underside sits 10 mm above the plate.
const cube: TriangleMesh = {
  positions: new Float32Array([
    -5, 10, -5, 5, 10, -5, 5, 10, 5, -5, 10, 5,
    -5, 20, -5, 5, 20, -5, 5, 20, 5, -5, 20, 5,
  ]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]),
};

/** Every component is a closed solid: each undirected edge is shared by exactly two triangles. */
function componentsAreClosed(mesh: GeneratedSupportMesh): boolean {
  return mesh.components.every((component) => {
    const edges = new Map<string, number>();
    for (let offset = component.start; offset < component.start + component.count; offset += 3) {
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
        const first = mesh.indices[offset + a]!;
        const second = mesh.indices[offset + b]!;
        const key = first < second ? `${first}:${second}` : `${second}:${first}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    return [...edges.values()].every((count) => count === 2) && signedVolume(mesh, component) > 0;
  });
}

function signedVolume(mesh: GeneratedSupportMesh, component: GeneratedSupportMesh['components'][number]): number {
  let volume = 0;
  const p = (index: number) => [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
  for (let offset = component.start; offset < component.start + component.count; offset += 3) {
    const [a, b, c] = [p(mesh.indices[offset]!), p(mesh.indices[offset + 1]!), p(mesh.indices[offset + 2]!)];
    volume += a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  }
  return volume / 6;
}

describe('buildSupportMesh', () => {
  it('builds a single support from the plate up through the contact tip', () => {
    const mesh = buildSupportMesh([contact], settings);

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(meshBounds(mesh).min[1]).toBeCloseTo(0);
    expect(meshBounds(mesh).max[1]).toBeGreaterThan(contact.position[1]);
    expect(mesh.parts).toEqual(expect.arrayContaining(['tip', 'neck', 'pillar', 'foot', 'raft']));
    expect(componentsAreClosed(mesh)).toBe(true);
    expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
  });

  it('maps support components back to their contact for picking', () => {
    const mesh = buildSupportMesh([contact, neighbour], settings);
    const owners = new Set(mesh.components.filter((component) => component.contactId).map((component) => component.contactId));

    expect(owners).toEqual(new Set(['auto-0', 'auto-1']));
    expect(contactAtTriangle(mesh, mesh.components.find((component) => component.contactId === 'auto-1')!.start / 3)).toBe('auto-1');
  });

  it('stands feet on the plate, embedded in the raft floor, as Blender does', () => {
    const withoutRaft = buildSupportMesh([contact], updateSetting(settings, 'raftEnabled', false));
    expect(withoutRaft.parts).not.toContain('raft');
    expect(meshBounds(withoutRaft).min[1]).toBeCloseTo(0);

    const raft = buildSupportMesh([contact], settings);
    const foot = raft.components.find((component) => component.part === 'foot')!;
    expect(minY(raft, foot)).toBeCloseTo(0);
  });

  it('builds the raft floor and gapped rim leaning outward going up (Blender SLASG profile)', () => {
    const mesh = buildSupportMesh([contact], updateSetting(settings, 'labelEnabled', false));
    const raft = mesh.components.filter((component) => component.part === 'raft');
    const reachAt = (y: number) => {
      let reach = 0;
      for (const component of raft) {
        for (let offset = component.start; offset < component.start + component.count; offset += 1) {
          const vertex = mesh.indices[offset]! * 3;
          if (Math.abs(mesh.positions[vertex + 1]! - y) < 1e-4) reach = Math.max(reach, Math.abs(mesh.positions[vertex]!));
        }
      }
      return reach;
    };
    const slope = Math.tan(settings.raftWallAngle * Math.PI / 180);
    expect(raft.length).toBeGreaterThan(2);
    expect(reachAt(0)).toBeCloseTo(settings.raftExpandWidth, 1);
    expect(reachAt(settings.raftFloorThickness)).toBeCloseTo(settings.raftExpandWidth + settings.raftFloorThickness * slope, 1);
    expect(reachAt(settings.raftWallHeight)).toBeCloseTo(settings.raftExpandWidth + settings.raftWallHeight * slope, 1);
  });

  it('adds braces between tall neighbouring pillars only when enabled', () => {
    const tall = [contact, neighbour].map((point) => ({ ...point, position: [point.position[0], 20, 0] as [number, number, number] }));
    const short = [contact, neighbour].map((point) => ({ ...point, position: [point.position[0], 7, 0] as [number, number, number] }));
    expect(buildSupportMesh(short, settings).parts).not.toContain('brace');
    expect(buildSupportMesh(tall, settings).parts).toContain('brace');
    expect(buildSupportMesh(tall, updateSetting(settings, 'trussEnabled', false)).parts).not.toContain('brace');
  });

  it('merges nearby supports into tree branches and a trunk', () => {
    const treeContacts: SupportContact[] = [contact, { ...neighbour, id: 'auto-2', position: [1.5, 10, 0] }];
    const tree = buildSupportMesh(treeContacts, { ...settings, scatterAutoTree: true });

    expect(tree.parts).toContain('tree-branch');
    expect(tree.parts).toContain('tree-trunk');
    expect(componentsAreClosed(tree)).toBe(true);
  });

  it('honours resolution, low poly, preview mode, and full export geometry', () => {
    const coarse = buildSupportMesh([contact], updateSetting(settings, 'resolution', 6));
    const fine = buildSupportMesh([contact], updateSetting(settings, 'resolution', 24));
    const lowPoly = buildSupportMesh([contact], updateSetting(settings, 'lowPolyMode', true));
    const tipOnly = { ...settings, previewMode: 'ONLY_TIP' as const };

    expect(fine.positions.length).toBeGreaterThan(coarse.positions.length);
    expect(lowPoly.positions.length).toBeLessThan(buildSupportMesh([contact], settings).positions.length);
    expect(buildSupportMesh([contact], tipOnly).parts).toEqual(['tip', 'neck']);
    expect(buildSupportMesh([contact], tipOnly, { mode: 'export' }).parts).toContain('pillar');
  });

  it('matches the Blender column profile: foot, pillar and a vertical neck cone under a downward contact', () => {
    const sideways: SupportContact = { id: 'down', position: [0, 5, 0], normal: [0, -1, 0] };
    const mesh = buildSupportMesh([sideways], updateSetting(settings, 'raftEnabled', false));
    const part = (name: string) => componentBounds(mesh, mesh.components.find((component) => component.part === name)!);

    const neck = part('neck');
    expect(neck.min[1]).toBeCloseTo(5 - settings.neckLength);
    expect(neck.max[0]).toBeCloseTo(settings.pillarDiameter / 2, 2);
    const foot = part('foot');
    expect(foot.min[1]).toBeCloseTo(0);
    expect(foot.max[1]).toBeCloseTo(settings.baseHeight);
    expect(foot.max[0]).toBeCloseTo(settings.baseDiameter / 2, 2);
    expect(part('pillar').max[1]).toBeCloseTo(5 - settings.neckLength);
  });

  it('tilts the neck along the normal, clamped to the connection angle (Blender: 1.41 mm shift at 45 degrees)', () => {
    const slanted: SupportContact = { id: 'slant', position: [0, 8, 0], normal: [0, -Math.SQRT1_2, -Math.SQRT1_2] };
    const steep: SupportContact = { id: 'steep', position: [10, 8, 0], normal: [1, 0, 0] };
    const mesh = buildSupportMesh([slanted, steep], updateSetting(settings, 'raftEnabled', false));
    const foot = (id: string) => componentBounds(mesh, mesh.components.find((component) => component.part === 'foot' && component.contactId === id)!);
    const shift = (id: string, x: number) => Math.hypot((foot(id).min[0]! + foot(id).max[0]!) / 2 - x, (foot(id).min[2]! + foot(id).max[2]!) / 2);

    expect(shift('slant', 0)).toBeCloseTo(settings.neckLength * Math.sin(Math.PI / 4), 2);
    expect(shift('steep', 10)).toBeCloseTo(settings.neckLength * Math.sin(settings.maxNeckAngle * Math.PI / 180), 2);
  });

  it('builds a roof above the model and a cage around it', () => {
    const roofSettings = setRoofMode(settings, 'ROOF');
    const roof = buildSupportMesh([contact], roofSettings, { model: cube });
    expect(roof.parts).toEqual(expect.arrayContaining(['roof', 'column', 'roof-brace', 'cross-bar']));
    expect(meshBounds(roof).max[1]).toBeCloseTo(20 + roofSettings.roofGap + roofSettings.storeyFloorThickness, 1);

    const cageSettings = setRoofMode(settings, 'CAGE');
    const cage = buildSupportMesh([contact], cageSettings, { model: cube });
    expect(cage.parts).toEqual(expect.arrayContaining(['column', 'cage-ring']));
    expect(meshBounds(cage).max[1]).toBeGreaterThanOrEqual(20 + cageSettings.cageTopGap);
    expect(meshBounds(cage).max[0]).toBeGreaterThan(5 + cageSettings.cageSideGap - 1);
    expect(componentsAreClosed(cage)).toBe(true);
  });

  it('embosses the unit letter on a raft pad only when the raft exists', () => {
    const labelled = buildSupportMesh([contact], settings, { labelText: 'B' });
    expect(labelled.parts).toContain('label');
    expect(componentsAreClosed(labelled)).toBe(true);
    expect(buildSupportMesh([contact], updateSetting(settings, 'raftEnabled', false), { labelText: 'B' }).parts).not.toContain('label');
    expect(buildSupportMesh([contact], updateSetting(settings, 'labelEnabled', false), { labelText: 'B' }).parts).not.toContain('label');
  });

  it('is deterministic and returns an empty mesh without contacts', () => {
    expect(buildSupportMesh([contact, neighbour], settings)).toEqual(buildSupportMesh([contact, neighbour], settings));
    expect(buildSupportMesh([], settings).indices.length).toBe(0);
  });
});

function componentBounds(mesh: GeneratedSupportMesh, component: GeneratedSupportMesh['components'][number]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = component.start; offset < component.start + component.count; offset += 1) {
    const vertex = mesh.indices[offset]! * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, mesh.positions[vertex + axis]!);
      max[axis] = Math.max(max[axis]!, mesh.positions[vertex + axis]!);
    }
  }
  return { min, max };
}

function minY(mesh: GeneratedSupportMesh, component: GeneratedSupportMesh['components'][number]): number {
  return componentBounds(mesh, component).min[1]!;
}
