import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import { centreInPlace, geometryToMesh, importGltfUnits, importStl, placeImportedUnits, weldRawMesh } from './import';
import { identityTransform, type PrintUnit } from './project';
import { meshBounds } from '../core/supports/meshQuery';
import { applyTransform } from './transform';

describe('geometryToMesh', () => {
  it('welds coincident STL vertices so connected faces share indices', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1], 3));
    const mesh = geometryToMesh(geometry);

    expect(mesh.positions.length / 3).toBe(4);
    expect(mesh.indices.length).toBe(6);
  });
});

/** A one-triangle binary STL. */
function stlOf(vertices: number[]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(84 + 50));
  view.setUint32(80, 1, true);
  vertices.forEach((value, k) => view.setFloat32(96 + k * 4, value, true));
  return view.buffer;
}

describe('non-finite vertices', () => {
  const triangle = (bad: number) => [0, 0, 0, 1, 0, 0, 0, bad, 1];

  it('rejects an STL or glTF mesh with a NaN or infinite coordinate, naming the file', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => importStl(stlOf(triangle(bad)), 'C:/models/broken.stl')).toThrow(/^broken has vertex coordinates that are not finite numbers/);
      expect(() => weldRawMesh({ name: 'Part 1', positions: new Float32Array(triangle(bad)), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }))
        .toThrow(/^Part 1 has vertex coordinates/);
    }
  });

  it('accepts finite coordinates', () => {
    expect(importStl(stlOf(triangle(1)), 'ok.stl').mesh.indices.length).toBe(3);
  });
});

describe('importGltfUnits', () => {
  it('imports every glTF mesh as its own unit with world transforms baked in', () => {
    const root = new Group();
    const first = new Mesh(new BoxGeometry(2, 2, 2));
    const second = new Mesh(new BoxGeometry(2, 2, 2));
    second.position.set(10, 0, 0);
    first.name = 'Left';
    root.add(first, second);
    const gltfFixture = { scene: root };

    const units = importGltfUnits(gltfFixture, 'pair.glb');
    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.name)).toEqual(['Left', 'pair 2']);
    expect(meshBounds(units[1]!.mesh).min[0]).toBeCloseTo(9);
  });
});

describe('placeImportedUnits', () => {
  const box = geometryToMesh(new BoxGeometry(4, 4, 4));

  it('centres each unit on its own pivot, lifts it, and keeps imports apart from existing units', () => {
    let next = 0;
    const [first] = placeImportedUnits([{ name: 'A', mesh: box }], [], { lift: 5, createId: () => `unit-${next++}` });
    expect(first).toMatchObject({ id: 'unit-0', name: 'A', manual: [], suppressed: [] });
    const world = meshBounds(applyTransform(first!.source, first!.transform));
    expect(world.min[1]).toBeCloseTo(5);
    expect(meshBounds(first!.source).min[0]).toBeCloseTo(-2);

    const [second] = placeImportedUnits([{ name: 'B', mesh: box }], [first as PrintUnit], { lift: 5, createId: () => `unit-${next++}` });
    expect(meshBounds(applyTransform(second!.source, second!.transform)).min[0]).toBeGreaterThan(world.max[0]);
  });

  it('keeps relative glTF placement within one import', () => {
    const shifted = { positions: box.positions.map((value, index) => index % 3 === 0 ? value + 10 : value), indices: box.indices };
    const units = placeImportedUnits([{ name: 'A', mesh: box }, { name: 'B', mesh: shifted }], [], { lift: 5, createId: (() => { let id = 0; return () => `u${id++}`; })() });
    const [a, b] = units.map((unit) => meshBounds(applyTransform(unit.source, unit.transform)));
    expect(b!.min[0] - a!.min[0]).toBeCloseTo(10);
    expect(units[0]!.transform.rotation).toEqual(identityTransform.rotation);
  });
});

describe('centreInPlace', () => {
  it('gives the same unit source and placement as centring in placeImportedUnits, without a copy', () => {
    const shifted = { positions: geometryToMesh(new BoxGeometry(4, 6, 2)).positions.map((value, index) => value + [10.123, 3.3, -7.77][index % 3]!), indices: geometryToMesh(new BoxGeometry(4, 6, 2)).indices };
    const options = () => ({ lift: 5, createId: () => 'u' });
    const [plain] = placeImportedUnits([{ name: 'A', mesh: { positions: shifted.positions.slice(), indices: shifted.indices.slice() } }], [], options());
    const centred = centreInPlace({ name: 'A', mesh: shifted });
    const [fast] = placeImportedUnits([centred], [], options());
    expect(fast!.source).toBe(shifted);
    expect(fast!.source.positions).toEqual(plain!.source.positions);
    expect(fast!.transform).toEqual(plain!.transform);
  });
});
