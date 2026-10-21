import { describe, expect, it } from 'vitest';
import stages from '../../tools/blender-parity/ridge_stages.json';
import { blenderVertexNormals } from '../analysis/blenderBvh';
import { blenderEdges, legacyRidgeMidpoints } from '../analysis/legacyRidges';
import { minimaStages } from '../analysis/placement';

type Vector = [number, number, number];

/**
 * Legacy SDF ridge points against Resin UV's patched SLASG_VertexScatter_Mixo itself, stage by
 * stage (tools/blender-parity/ridge_dump.py on the v-ridge, Spacing 2, Angle 50 degrees,
 * Reinforce Overhang Edges off). The stages run on Blender's own R, so they are bit for bit;
 * positions are Blender's (X, Y, Z).
 */
describe('Blender legacy ridges (v-ridge, stage by stage)', () => {
  const R = stages.R as Vector[];
  const faces = stages.R_faces;
  const normals = blenderVertexNormals(R, faces);
  const toWeb = ([x, y, z]: Vector): Vector => [x, z, -y];
  const toBlender = ([x, y, z]: Vector): Vector => [x, -z, y];
  const remesh = { vertices: R.map(toWeb), faces, normals: faces.map(() => null) };
  const clean = (points: readonly (readonly number[])[]) => points.map((point) => point.map((value) => value + 0));

  it("orders R's edges and true vertex normals as Blender does", () => {
    expect(blenderEdges(faces)).toEqual(stages.R_edges);
    expect(clean(normals)).toEqual(clean(stages.R_normals));
  });

  for (const degrees of [30, 45, 60] as const) {
    const stage = stages[`ridge_${degrees}`];
    it(`keeps the same ridge midpoints at Ridge Angle ${degrees}`, () => {
      expect(clean(legacyRidgeMidpoints(R, faces, normals, degrees, 50))).toEqual(clean(stage.midpoints));
    });

    it(`merges, snaps and filters minima and ridge points the same way at Ridge Angle ${degrees}`, () => {
      const st = minimaStages(remesh, { spacing: 2, overhangAngleDegrees: 50, sharpEdgeAngleDegrees: degrees, reinforceEdges: false } as never);
      expect(st.candidatePoints.length).toBe(stage.candidates.co.length);
      expect(clean(st.candidatePoints.map(toBlender))).toEqual(clean(stage.candidates.co));
      expect(clean(st.merged.map(toBlender))).toEqual(clean(stage.merged.co));
      expect(clean(st.snapped.map(toBlender))).toEqual(clean(stage.snapped.co));
      expect(clean(st.kept.map(toBlender))).toEqual(clean(stage.kept.co));
      // SLASG_Line: Vertical > 0 (a minimum in the cluster) wins over Edge > 0.
      expect(st.keptVertical).toEqual(stage.kept.Vertical!.map((value) => value > 0));
      expect(stage.kept.Edge!.every((value, k) => value > 0 || stage.kept.Vertical![k]! > 0)).toBe(true);
    });
  }
});
