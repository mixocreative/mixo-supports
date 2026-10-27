import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BrushFixture } from '../../scripts/fixtures/brush/types';
import { approxArray, exactArray, expectGolden, readGolden } from '../../scripts/test-support/golden';
import { seededRays } from '../../scripts/test-support/knotRays';
import { nodeEngine, parseStl } from '../../scripts/test-support/rustImport';
import { fromLeftHandedMatrix, toLeftHanded, toLeftHandedMatrix } from '../core/handedness';
import { applyToDirection, applyToPoint, invertMatrix, placementMatrix, transformPositions } from '../../scripts/test-support/matrix';

/*
 * U2 parity: the Rust core (pkg-node build) against the TS implementations it replaces. Rule 7:
 * face ids and indices identical, positions within 1e-5 mm.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engine = nodeEngine as unknown as Record<string, any>;
const fixtureBytes = readFileSync('scripts/fixtures/brush/aligner-brush.json');
const FIXTURE = JSON.parse(new TextDecoder().decode(new Uint8Array(fixtureBytes.buffer, fixtureBytes.byteOffset, fixtureBytes.byteLength))) as BrushFixture;
const knotBytes = readFileSync('scripts/fixtures/knot.stl');
const knot = parseStl(new Uint8Array(knotBytes.buffer, knotBytes.byteOffset, knotBytes.byteLength), 'knot');
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst;
};

describe('recorded aligner camera + strokes: Rust pick and project_brush equal the three.js / MeshBVH / screenBrush answers', () => {
  const aligner = readFileSync(FIXTURE.aligner);
  const mesh = parseStl(new Uint8Array(aligner.buffer, aligner.byteOffset, aligner.byteLength), 'aligner');
  const session = new engine.GeometrySession(0x30000000);
  const handle = session.load_mesh(mesh.positions, mesh.indices);
  const slots = FIXTURE.bodies.first.length - 1;

  it('the recorded fixture (aligner-brush.json, made once by the TS oracle) is for this aligner', () => {
    expect(mesh.indices.length / 3).toBe(FIXTURE.triangles);
  });

  const brush = (c: (typeof FIXTURE.cases)[number], stroke: (typeof FIXTURE.cases)[number]['strokes'][number], start = 0, end = slots, want = new Uint8Array()) =>
    Array.from(session.project_brush(
      Float32Array.from(FIXTURE.bodies.points), Uint32Array.from(FIXTURE.bodies.first),
      Uint32Array.of(handle), Float64Array.from(c.supportToModel), Uint32Array.of(0),
      Float64Array.from(c.clip), Float64Array.from(c.eye), Float64Array.of(FIXTURE.width, FIXTURE.height),
      stroke.radius, Float64Array.from(stroke.points), start, end, want,
    ) as Uint32Array);

  for (const c of FIXTURE.cases) {
    it(`${c.name}: pixel pick face ids are identical`, () => {
      const out = session.pick_pixels(handle, Float64Array.from(c.clipToModel), FIXTURE.width, FIXTURE.height, Float64Array.from(c.pixels), 0, Infinity, 0) as Float64Array;
      expect(Array.from({ length: c.pickFaces.length }, (_, k) => out[k * 5]!)).toEqual(c.pickFaces);
    });

    it(`${c.name}: brush strokes touch and see the same supports (occluded ones included)`, () => {
      expect(c.strokes.map((stroke) => brush(c, stroke))).toEqual(c.strokes.map((stroke) => stroke.slots));
    });
  }

  it('the fixture exercises occlusion: some touched supports are hidden behind the model', () => {
    expect(FIXTURE.cases.flatMap((c) => c.strokes).some((stroke) => stroke.hiddenSlots.length > 0)).toBe(true);
    expect(FIXTURE.cases.flatMap((c) => c.strokes).some((stroke) => stroke.slots.length > 0)).toBe(true);
  });

  it('a start/end slice and the want mask restrict the tested slots', () => {
    const c = FIXTURE.cases[1]!;
    const stroke = c.strokes.find((s) => s.slots.length > 1)!;
    const split = stroke.slots[1]!;
    expect(brush(c, stroke, 0, split)).toEqual(stroke.slots.filter((slot) => slot < split));
    expect(brush(c, stroke, split, slots)).toEqual(stroke.slots.filter((slot) => slot >= split));
    const want = new Uint8Array(slots).fill(1);
    want[stroke.slots[0]!] = 0;
    expect(brush(c, stroke, 0, slots, want)).toEqual(stroke.slots.slice(1));
  });

  it('bad shapes and handles are typed errors', () => {
    expect(() => session.pick(handle, new Float64Array(5), 0, 1, 0)).toThrow(expect.objectContaining({ code: 'INVALID_LENGTH' }));
    expect(() => session.pick(999, new Float64Array(6), 0, 1, 0)).toThrow(expect.objectContaining({ code: 'INVALID_HANDLE' }));
    expect(() => session.pick(handle, new Float64Array(6), 0, 1, 7)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => session.transform(handle, new Float64Array(15), 0)).toThrow(expect.objectContaining({ code: 'INVALID_LENGTH' }));
    expect(() => session.transform(handle, new Float64Array(16).fill(NaN), 0)).toThrow(expect.objectContaining({ code: 'NON_FINITE' }));
    session.release_mesh(handle);
    expect(session.used_bytes()).toBe(0);
  });
});

describe('random rays: Rust BVH picks the same face as the recorded three-mesh-bvh answers', () => {
  it('on the knot, double sided', () => {
    const recorded = readGolden<{ faces: number[]; distances: number[] }>('knot-random-rays');
    const session = new engine.GeometrySession(0x10000000);
    const handle = session.load_mesh(knot.positions, knot.indices);
    const rays = seededRays(knot);
    const out = session.pick(handle, Float64Array.from(rays), 0, Infinity, 2) as Float64Array;
    let hits = 0;
    let ties = 0;
    for (let k = 0; k < rays.length / 6; k++) {
      const face = out[k * 5]!;
      const expectedFace = recorded.faces[k]!;
      const expectedDistance = recorded.distances[k]!;
      if (face !== expectedFace) {
        // A ray through an edge or a coincident face hits two faces at exactly the same distance;
        // which one an index reports first is traversal-dependent (Rust: lowest face id).
        expect(expectedFace, `ray ${k}`).toBeGreaterThanOrEqual(0);
        expect(Math.abs(out[k * 5 + 1]! - expectedDistance), `ray ${k} tie`).toBeLessThan(1e-9);
        ties += 1;
        continue;
      }
      if (expectedFace >= 0) {
        hits += 1;
        expect(Math.abs(out[k * 5 + 1]! - expectedDistance)).toBeLessThan(1e-5);
      }
    }
    expect(hits).toBeGreaterThan(40);
    expect(ties, "equal-distance ties (coincident faces in the knot) stay rare").toBeLessThan(hits * 0.25);
    session.release_mesh(handle);
  });
});

describe('transform, handedness, normals, overlay vertices', () => {
  const placements = [
    { position: [0, 0, 0], rotation: [0, 0, 0] },
    { position: [12.5, -3, 40], rotation: [0.3, -1.2, 2.5] },
    { position: [-80, 7, 0.5], rotation: [3.1, 0.01, -0.7] },
  ] as const;

  it('placement matrix, inverse, points and directions match src/core/transform', () => {
    for (const p of placements) {
      const ts = placementMatrix({ position: [...p.position], rotation: [...p.rotation] });
      const rust = engine.placement_matrix(Float64Array.from(p.position), Float64Array.from(p.rotation)) as Float64Array;
      expect(maxDiff(rust, ts)).toBeLessThan(1e-12);
      expect(maxDiff(engine.invert_matrix(rust) as Float64Array, invertMatrix(ts))).toBeLessThan(1e-12);
      const values = Float64Array.of(1, 2, 3, -40, 5.5, 0.25, 0, 0, 0);
      const points = engine.transform_vectors(values, rust, false) as Float64Array;
      const directions = engine.transform_vectors(values, rust, true) as Float64Array;
      for (let k = 0; k < 3; k++) {
        expect(maxDiff(points.subarray(k * 3, k * 3 + 3), applyToPoint(ts, values[k * 3]!, values[k * 3 + 1]!, values[k * 3 + 2]!))).toBeLessThan(1e-9);
        expect(maxDiff(directions.subarray(k * 3, k * 3 + 3), applyToDirection(ts, values[k * 3]!, values[k * 3 + 1]!, values[k * 3 + 2]!))).toBeLessThan(1e-12);
      }
    }
  });

  it('a session mesh transforms like transformPositions, right and left handed', () => {
    const session = new engine.GeometrySession(0x10000000);
    const handle = session.load_mesh(knot.positions, knot.indices);
    for (const p of placements) {
      const ts = placementMatrix({ position: [...p.position], rotation: [...p.rotation] });
      const right = session.transform(handle, ts, 0) as Float32Array;
      expect(maxDiff(right, transformPositions(knot.positions, ts))).toBeLessThan(1e-5);
      const left = session.transform(handle, ts, 1) as Float32Array;
      expect(maxDiff(left, toLeftHanded({ positions: transformPositions(knot.positions, ts), indices: knot.indices }).positions)).toBeLessThan(1e-5);
      // The conjugated matrix on the mirrored mesh is the same thing (handedness contract).
      const viaMatrix = transformPositions(toLeftHanded(knot).positions, toLeftHandedMatrix(ts));
      expect(maxDiff(left, viaMatrix)).toBeLessThan(1e-4);
      expect(maxDiff(fromLeftHandedMatrix(toLeftHandedMatrix(ts)), ts)).toBe(0);
      expect(maxDiff(transformPositions(knot.positions, ts), engine.transform_positions(knot.positions, ts, 0) as Float32Array)).toBeLessThan(1e-5);
    }
    session.release_mesh(handle);
  });

  it('vertex normals match the recorded TS result', () => {
    expectGolden('knot-vertex-normals', approxArray(engine.vertex_normals(knot.positions, knot.indices) as Float32Array, 31));
  });

  it('refineForOverlay matches the recorded TS refine; dentalFaceOverlay and contour segments match the recorded TS result', () => {
    const faces = knot.indices.length / 3;
    const refined = ([[1e9, faces * 2], [4, faces * 3], [1.5, faces * 3]] as const).map(([maxEdge, maxTriangles]) => {
      const rust = engine.refine_for_overlay(knot.positions, knot.indices, maxEdge, maxTriangles);
      const result = { indices: exactArray(rust.take_indices() as Uint32Array), positions: approxArray(rust.take_positions() as Float32Array, 211) };
      rust.free();
      return result;
    });
    expectGolden('knot-refine-overlay', refined);
    const allowed = Uint8Array.from({ length: faces }, (_, f) => (f % 3 === 0 ? 1 : 0));
    const rustFaces = engine.dental_face_overlay(knot.positions, knot.indices, allowed);
    const overlayPositions = rustFaces.take_positions() as Float32Array;
    const overlayNormals = rustFaces.take_normals() as Float32Array;
    rustFaces.free();
    const pairs = Uint32Array.of(0, 5, 7, 9);
    expectGolden('knot-dental-overlay', { positions: approxArray(overlayPositions, 53), normals: approxArray(overlayNormals, 53), segments: engine.dental_contour_segments(knot.positions, pairs) as Float32Array });
    expect(() => engine.dental_face_overlay(knot.positions, knot.indices, new Uint8Array(3))).toThrow(expect.objectContaining({ code: 'INVALID_LENGTH' }));
  });
});
