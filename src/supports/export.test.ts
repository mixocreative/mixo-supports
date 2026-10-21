import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { importStlUnit } from '../state/import';
import { describe, expect, it } from 'vitest';
import type { SupportPoint, TriangleMesh } from '../analysis/types';
import { emptyScene, type PrintScene, type PrintUnit } from '../state/project';
import { encodeStl, planExport, uniqueFileNames, type ExportPart } from './export';
import { meshBounds } from './mesh';
import { applyTransform } from '../state/transform';
import { unitSupportMesh } from './unitSupports';
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
    manual: [], suppressed: [], deleted: [], zones: [],
  };
}

const scene: PrintScene = {
  ...emptyScene,
  units: [unit('unit-a', 'Part', 0), unit('unit-b', 'Part', 20), unit('unit-c', 'Bare', 40, false)],
  selectedUnitIds: ['unit-a'],
  activeUnitId: 'unit-a',
};

describe('support export', () => {
  /** Parts of a planned file, built the way the export worker builds them. */
  const parts = (kind: Parameters<typeof planExport>[1], file = 0): ExportPart[] => planExport(scene, kind)[file]!.parts.map((part) => {
    const index = scene.units.findIndex((unit) => unit.id === part.unitId);
    const unit = scene.units[index]!;
    return { mesh: part.content === 'model' ? unit.source : unitSupportMesh(unit, index, 'export'), transform: unit.transform };
  });

  it('composes the active unit as printable or supports only', () => {
    expect(planExport(scene, 'active-printable')).toEqual([{ fileName: 'Part-printable.stl', parts: [{ unitId: 'unit-a', content: 'model' }, { unitId: 'unit-a', content: 'supports' }] }]);
    expect(planExport(scene, 'active-supports')[0]!.parts).toEqual([{ unitId: 'unit-a', content: 'supports' }]);
  });

  it('exports each unit separately and the whole scene together', () => {
    const separate = planExport(scene, 'separate-printable');
    expect(separate.map((file) => file.fileName)).toEqual(['Part-printable.stl', 'Part-printable-2.stl', 'Bare-printable.stl']);
    expect(planExport(scene, 'separate-supports')).toHaveLength(2);
    const whole = planExport(scene, 'whole-printable');
    expect(whole).toHaveLength(1);
    expect(whole[0]!.fileName).toBe('scene-printable.stl');
    expect(whole[0]!.parts.length).toBeGreaterThan(scene.units.length);
  });

  it('places geometry with the current unit transform and the plate at y = 0', () => {
    const [model, supports] = parts('active-printable');
    expect(meshBounds(applyTransform(model!.mesh, model!.transform)).min[1]).toBeCloseTo(5);
    expect(meshBounds(applyTransform(supports!.mesh, supports!.transform)).min[1]).toBeCloseTo(0);
  });

  it('never mutates source meshes and encodes binary STL with every triangle', () => {
    const before = Array.from(cube.positions);
    const file = parts('active-printable');
    const triangles = file.reduce((sum, part) => sum + part.mesh.indices.length / 3, 0);
    const progress: number[] = [];
    const stl = encodeStl(file, (fraction) => progress.push(fraction));

    expect(new DataView(stl).getUint32(80, true)).toBe(triangles);
    expect(stl.byteLength).toBe(84 + triangles * 50);
    expect(Array.from(cube.positions)).toEqual(before);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('writes STL Z-up and reads it back Y-up unchanged', () => {
    const tall: TriangleMesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 5, 0]), indices: new Uint32Array([0, 1, 2]) };
    const stl = encodeStl([{ mesh: tall, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } }]);
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
