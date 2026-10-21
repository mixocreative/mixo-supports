import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import stages from '../../tools/blender-parity/minima_stages.json';
import { vertexNormals } from '../core/analysis/vertexNormals';
import { minimaStages } from '../core/analysis/placement';
import { geometryToMesh } from '../state/import';
import { RemeshTarget } from '../core/supports/remesh';

type Vector = [number, number, number];

/**
 * Island minima against SLASG_VertexScatter itself, stage by stage
 * (tools/blender-parity/minima_dump.py on the mushroom, Spacing 2, 45 degrees, SDF ridges off
 * as Resin UV runs it). Every stage is bit for bit; positions are Blender's (X, Y, Z).
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
    expect(clean(vertexNormals(stages.R as Vector[], stages.R_faces))).toEqual(clean(stages.R_normals));
  });

  it('finds the same candidates, merges and snaps them the same way, and keeps the same minima', () => {
    expect(at(st.candidates)).toEqual(clean(stages.candidates));
    expect(clean(st.merged.map(toBlender))).toEqual(clean(stages.merged));
    expect(clean(st.snapped.map(toBlender))).toEqual(clean(stages.snapped));
    expect(clean(st.kept.map(toBlender))).toEqual(clean(stages.kept));
  });
});
