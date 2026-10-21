import { describe, expect, it } from 'vitest';
import stages from '../../../tools/blender-parity/ridge_stages.json';
import { vertexNormals } from '../analysis/vertexNormals';
import { legacyRidgeMidpoints, meshEdges } from '../analysis/legacyRidges';
import { compareKeeps, compareMerges, compareSnaps } from '../analysis/parity.testkit';
import { minimaStages } from '../analysis/placement';

type Vector = [number, number, number];

/** Ridge midpoints in only one of the two results, all of them ambiguous-convexity edges. */
const AMBIGUOUS: Record<30 | 45 | 60, number> = { 30: 2, 45: 0, 60: 0 };
/** Stage results bit for bit vs explained ties, pinned so a drift shows. */
const PINNED: Record<30 | 45 | 60, { merge: number[]; snap: number[]; keep: number[] }> = {
  30: { merge: [14, 15], snap: [27, 2], keep: [28, 1] },
  45: { merge: [14, 13], snap: [23, 4], keep: [25, 2] },
  60: { merge: [7, 19], snap: [20, 6], keep: [25, 1] },
};

/**
 * Legacy SDF ridge points against Resin UV's patched SLASG_VertexScatter_Mixo itself, stage by
 * stage (tools/blender-parity/ridge_dump.py on the v-ridge, Spacing 2, Angle 50 degrees,
 * Reinforce Overhang Edges off), on Blender's own R; positions are Blender's (X, Y, Z). Edge
 * order and normals are bit for bit. Ridge midpoints match except edges whose convexity is
 * ambiguous (face 2's corners off the edge lie on both sides of face 1's plane: Blender's quad
 * triangulation decides, the web uses face 2's centroid). Merge, snap and keep run on
 * Blender's own stage inputs and are tie-aware (see parity.testkit.ts).
 */
describe('Blender legacy ridges (v-ridge, stage by stage)', () => {
  const R = stages.R as Vector[];
  const faces = stages.R_faces;
  const normals = vertexNormals(R, faces);
  const toWeb = ([x, y, z]: Vector): Vector => [x, z, -y];
  const toBlender = ([x, y, z]: Vector): Vector => [x, -z, y];
  const remesh = { vertices: R.map(toWeb), faces, normals: faces.map(() => null) };
  const clean = (points: readonly (readonly number[])[]) => points.map((point) => point.map((value) => value + 0));

  it("orders R's edges (first use, under 1000 faces Blender's order too) and true vertex normals as Blender does", () => {
    expect(meshEdges(faces)).toEqual(stages.R_edges);
    expect(clean(normals)).toEqual(clean(stages.R_normals));
  });

  /** Edges whose second face straddles the first face's plane: their convexity is ambiguous. */
  const ambiguous = new Set<string>();
  for (const [a, b] of meshEdges(faces)) {
    const users = faces.filter((face) => face.includes(a) && face.includes(b));
    if (users.length !== 2) continue;
    const plane = users[0]!.map((v) => R[v]!);
    const n = [0, 1, 2].map((axis) => plane.reduce((sum, p, k) => {
      const q = plane[(k + 1) % plane.length]!;
      const [i, j] = [(axis + 1) % 3, (axis + 2) % 3];
      return sum + (p[i]! - q[i]!) * (p[j]! + q[j]!);
    }, 0));
    const sides = users[1]!.filter((v) => v !== a && v !== b)
      .map((v) => Math.sign([0, 1, 2].reduce((sum, axis) => sum + n[axis]! * (R[v]![axis]! - (R[a]![axis]! + R[b]![axis]!) / 2), 0)));
    if (sides.includes(1) && sides.includes(-1)) ambiguous.add([0, 1, 2].map((axis) => Math.fround((R[a]![axis]! + R[b]![axis]!) / 2) + 0).join());
  }

  for (const degrees of [30, 45, 60] as const) {
    const stage = stages[`ridge_${degrees}`];
    it(`keeps the same ridge midpoints at Ridge Angle ${degrees}, up to ambiguous convexity`, () => {
      const ours = clean(legacyRidgeMidpoints(R, faces, normals, degrees, 50)).map((p) => p.join());
      const theirs = clean(stage.midpoints).map((p) => p.join());
      const keepUnambiguous = (list: string[]) => list.filter((p) => !ambiguous.has(p));
      expect(keepUnambiguous(ours)).toEqual(keepUnambiguous(theirs));
      expect(ours.filter((p) => !theirs.includes(p)).length + theirs.filter((p) => !ours.includes(p)).length).toBe(AMBIGUOUS[degrees]);
    });

    it(`merges, snaps and filters minima and ridge points like Blender up to defined ties at Ridge Angle ${degrees}`, () => {
      const st = minimaStages(remesh, { spacing: 2, overhangAngleDegrees: 50, sharpEdgeAngleDegrees: degrees, reinforceEdges: false } as never);
      // The web candidates are Blender's, plus or minus the ambiguous ridge midpoints.
      const ours = clean(st.candidatePoints.map(toBlender)).map((p) => p.join()).filter((p) => !ambiguous.has(p));
      expect(ours).toEqual(clean(stage.candidates.co).map((p) => p.join()).filter((p) => !ambiguous.has(p)));
      const candidates = stage.candidates.co as Vector[];
      const merge = compareMerges(candidates, 2, stage.merged.co as Vector[]);
      const snap = compareSnaps(candidates, stage.merged.co as Vector[], stage.snapped.co as Vector[]);
      const keep = compareKeeps(stage.snapped.co as Vector[], R, normals, 50, stage.kept.co as Vector[]);
      expect([merge.unexplained, snap.unexplained, keep.unexplained]).toEqual([[], [], []]);
      expect({ merge: [merge.exact, merge.explained], snap: [snap.exact, snap.explained], keep: [keep.exact, keep.explained] }).toEqual(PINNED[degrees]);
      expect(st.keptVertical).toHaveLength(st.kept.length);
      // SLASG_Line: Vertical > 0 (a minimum in the cluster) wins over Edge > 0.
      expect(stage.kept.Edge!.every((value, k) => value > 0 || stage.kept.Vertical![k]! > 0)).toBe(true);
    });
  }
});
