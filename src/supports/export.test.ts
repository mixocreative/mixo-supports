import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { importStlUnit } from '../state/import';
import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../analysis/types';
import { emptyScene, type PrintScene, type PrintUnit } from '../state/project';
import { buildExportJobs, buildExportScene, encodeStl, uniqueFileNames } from './export';
import { meshBounds } from './mesh';
import { defaultSupportSettings } from './settings';

const cube: TriangleMesh = {
  positions: new Float32Array([-2, -2, -2, 2, -2, -2, 2, -2, 2, -2, -2, 2, -2, 2, -2, 2, 2, -2, 2, 2, 2, -2, 2, 2]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]),
};
const contact: SupportPoint = { id: 'auto-0', regionId: 0, position: [0, -2, 0], normal: [0, -1, 0], source: 'interior' };

function unit(id: string, name: string, x: number, supported = true): PrintUnit {
  const transform = { position: [x, 7, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
  return {
    id, name, source: cube, transform, settings: { ...defaultSupportSettings, roofSeededModes: [] },
    ...(supported ? {
      placement: { points: [contact], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() },
      supports: { kind: 'live', data: { transform } },
    } : {}),
    manual: [], suppressed: [],
  };
}

const scene: PrintScene = {
  ...emptyScene,
  units: [unit('unit-a', 'Part', 0), unit('unit-b', 'Part', 20), unit('unit-c', 'Bare', 40, false)],
  selectedUnitIds: ['unit-a'],
  activeUnitId: 'unit-a',
};

describe('support export', () => {
  it('composes the active unit as printable or supports only', () => {
    expect(buildExportScene(scene, { kind: 'active-printable' }).children).toHaveLength(2);
    expect(buildExportScene(scene, { kind: 'active-supports' }).children).toHaveLength(1);
  });

  it('exports each unit separately and the whole scene together', () => {
    const separate = buildExportJobs(scene, { kind: 'separate-printable' });
    expect(separate).toHaveLength(scene.units.length);
    expect(separate.map((job) => job.fileName)).toEqual(['Part-printable.stl', 'Part-printable-2.stl', 'Bare-printable.stl']);
    expect(buildExportJobs(scene, { kind: 'separate-supports' })).toHaveLength(2);
    expect(buildExportScene(scene, { kind: 'whole-printable' }).children.length).toBeGreaterThan(scene.units.length);
    expect(buildExportJobs(scene, { kind: 'whole-printable' })).toEqual([expect.objectContaining({ fileName: 'scene-printable.stl' })]);
  });

  it('places geometry with the current unit transform and the plate at y = 0', () => {
    const group = buildExportScene(scene, { kind: 'active-printable' });
    const [model, supports] = group.children as Mesh[];
    const position = (mesh: Mesh) => ({ positions: mesh.geometry.getAttribute('position').array as Float32Array, indices: new Uint32Array() });
    expect(meshBounds(position(model!)).min[1]).toBeCloseTo(5);
    expect(meshBounds(position(supports!)).min[1]).toBeCloseTo(0);
  });

  it('never mutates source meshes and encodes binary STL with every triangle', () => {
    const before = Array.from(cube.positions);
    const group = buildExportScene(scene, { kind: 'active-printable' });
    const triangles = (group.children as Mesh[]).reduce((sum, mesh) => sum + mesh.geometry.getIndex()!.count / 3, 0);
    const stl = encodeStl(group);

    expect(new DataView(stl).getUint32(80, true)).toBe(triangles);
    expect(stl.byteLength).toBe(84 + triangles * 50);
    expect(Array.from(cube.positions)).toEqual(before);
  });

  it('writes STL Z-up and reads it back Y-up unchanged', () => {
    const tall: TriangleMesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 5, 0]), indices: new Uint32Array([0, 1, 2]) };
    const group = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(tall.positions, 3));
    geometry.setIndex(new BufferAttribute(tall.indices, 1));
    group.add(new Mesh(geometry));
    const stl = encodeStl(group);
    const view = new DataView(stl);
    // Third vertex (web y = 5) is STL z = 5.
    expect([view.getFloat32(84 + 36, true), view.getFloat32(84 + 40, true), view.getFloat32(84 + 44, true)].map((v) => v + 0)).toEqual([0, 0, 5]);
    const imported = importStlUnit(new STLLoader().parse(stl), 'tall.stl').mesh;
    expect(Array.from(imported.positions).map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual(Array.from(tall.positions));
  });

  it('makes stable collision-free file names', () => {
    expect(uniqueFileNames(['a/b', 'a/b', 'A?b', ''])).toEqual(['a-b.stl', 'a-b-2.stl', 'A-b.stl', 'unit.stl']);
  });
});
