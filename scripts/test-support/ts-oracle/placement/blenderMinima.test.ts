import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import stages from '../../../../tools/blender-parity/minima_stages.json';
import { faceNormal, vertexNormals } from './vertexNormals';
import { minimaStages } from './placement';
import { compareKeeps, compareMerges, compareNormals, compareSnaps } from './parity.testkit';
import { RemeshTarget } from '../remesh/remesh';
import { geometryToMesh } from '../../rustImport';

type Vector = [number, number, number];

/** Vertex normals bit for bit vs within NORMAL_SLACK (corner-angle arccos differs from Blender's). */
const NORMALS_PIN = [851, 220];
const PINNED = { merge: [52, 47], snap: [84, 15], keep: [81, 18] };

/**
 * Island minima against SLASG_VertexScatter itself, stage by stage
 * (tools/blender-parity/minima_dump.py on the mushroom, Spacing 2, 45 degrees, SDF ridges off
 * as Resin UV runs it). R, normals and candidates are bit for bit. Merge, snap and keep are
 * checked stage by stage on Blender's own inputs, tie-aware: a web result may differ only where
 * it is an equally valid answer under the defined tie rules (pairs exactly Spacing apart merge;
 * the lowest index wins an exact distance tie). Positions are Blender's (X, Y, Z).
 */
describe('Blender island minima (mushroom, stage by stage)', () => {
  const stem = new BoxGeometry(4, 10, 4).translate(0, 10, 0).toNonIndexed();
  const cap = new BoxGeometry(20, 4, 20).translate(0, 17, 0).toNonIndexed();
  const model = geometryToMesh(mergeGeometries([stem, cap]) as BufferGeometry);
  const remesh = new RemeshTarget(model, 0, 0.5).fullMesh();
  const toBlender = ([x, y, z]: Vector): Vector => [x, -z, y];
  const st = minimaStages(remesh, { spacing: 2, overhangAngleDegrees: 45 } as never);
  // `+ 0` folds the -0 a negated axis can produce (toEqual tells -0 from 0).
  const clean = (points: readonly (readonly number[])[]) => points.map((point) => point.map((value) => value + 0));
  const at = (indices: number[]) => clean(indices.map((index) => toBlender(remesh.vertices[index]!)));

  it('builds the same R (vertices) and true vertex normals', () => {
    expect(clean(remesh.vertices.map(toBlender))).toEqual(clean(stages.R));
    const R = stages.R as Vector[];
    const normals = compareNormals(vertexNormals(R, stages.R_faces), stages.R_normals as Vector[], stages.R_faces, stages.R_faces.map((face) => faceNormal(R, face)));
    expect(normals.unexplained).toEqual([]);
    expect([normals.exact, normals.explained]).toEqual(NORMALS_PIN);
  });

  it('finds the same candidates bit for bit', () => {
    expect(at(st.candidates)).toEqual(clean(stages.candidates));
  });

  // The stage checks run minimaStages' building blocks on Blender's own inputs; the wiring of
  // minimaStages is covered by the goldens and blenderParity's MINIMA pin.
  it('merges, snaps and keeps like Blender up to defined ties', () => {
    const candidates = stages.candidates as Vector[];
    const merge = compareMerges(candidates, 2, stages.merged as Vector[]);
    const snap = compareSnaps(candidates, stages.merged as Vector[], stages.snapped as Vector[]);
    const keep = compareKeeps(stages.snapped as Vector[], stages.R as Vector[], vertexNormals(stages.R as Vector[], stages.R_faces), 45, stages.kept as Vector[]);
    expect([merge.unexplained, snap.unexplained, keep.unexplained]).toEqual([[], [], []]);
    // Pinned so a drift shows: how many stage results are bit for bit vs explained ties.
    expect({ merge: [merge.exact, merge.explained], snap: [snap.exact, snap.explained], keep: [keep.exact, keep.explained] }).toEqual(PINNED);
  });
});
