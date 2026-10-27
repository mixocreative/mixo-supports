import { describe, expect, it } from 'vitest';
import edgeOrder from '../../../../tools/blender-parity/edge_order_stages.json';
import stages from '../../../../tools/blender-parity/ridge_stages.json';
import { faceNormal, vertexNormals } from '../placement/vertexNormals';
import { legacyRidgeMidpoints, meshEdges } from '../placement/legacyRidges';
import { compareKeeps, compareMerges, compareNormals, compareSnaps } from '../placement/parity.testkit';
import { minimaStages } from '../placement/placement';

type Vector = [number, number, number];

/** Ridge midpoints in only one of the two results, all of them ambiguous-convexity edges. */
const AMBIGUOUS: Record<30 | 45 | 60, number> = { 30: 2, 45: 0, 60: 0 };
/** Vertex normals bit for bit vs within NORMAL_SLACK (corner-angle arccos differs from Blender's). */
const NORMALS_PIN = [442, 391];

/** meshEdges on the 1000+ face dump. */
const PINNED_ORDER = { count: 2189, first: [[7, 47], [7, 45], [45, 47], [8, 51]], fingerprint: 525089928 };

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

  it("orders R's edges as Blender does (first use; under 1000 faces Blender's order too), normals up to the arccos", () => {
    expect(meshEdges(faces)).toEqual(stages.R_edges);
    const report = compareNormals(normals, stages.R_normals as Vector[], faces, faces.map((face) => faceNormal(R, face)));
    expect(report.unexplained).toEqual([]);
    expect([report.exact, report.explained]).toEqual(NORMALS_PIN);
  });

  /** Edges whose second face straddles the first face's plane: their convexity is ambiguous. */
  const ambiguous = new Set<string>();
  for (const [a, b] of meshEdges(faces)) {
    const users = faces.filter((face) => face.some((v, k) => { const w = face[(k + 1) % face.length]!; return (v === a && w === b) || (v === b && w === a); }));
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
      // minimaStages itself (and its Vertical/Edge split) is covered by the goldens; the stage
      // checks above run its building blocks on Blender's inputs.
      // SLASG_Line: Vertical > 0 (a minimum in the cluster) wins over Edge > 0.
      expect(stage.kept.Edge!.every((value, k) => value > 0 || stage.kept.Vertical![k]! > 0)).toBe(true);
    });
  }
});

/**
 * An R of 1000+ faces (tools/blender-parity/edge_order_dump.py: the v-ridge scaled 1.25,
 * Spacing 2). Blender splits mesh_calc_edges over 8 hash maps there; the web keeps its own
 * first-use order by design (README "Defined tie rules"). The edge set must equal Blender's,
 * and the web order is pinned. Faces and edges are base64 little-endian Uint16 arrays.
 */
describe('Edge order on a 1000+ face R', () => {
  const u16 = (text: string) => {
    const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    return Array.from(new Uint16Array(bytes.buffer, 0, bytes.length / 2));
  };
  const corners = u16(edgeOrder.corners);
  let offset = 0;
  const faces = [...edgeOrder.faceSizes].map((size) => corners.slice(offset, (offset += Number(size))));
  const flat = u16(edgeOrder.edges);
  const blender = Array.from({ length: flat.length / 2 }, (_, k) => [flat[2 * k]!, flat[2 * k + 1]!] as [number, number]);
  const ours = meshEdges(faces);
  /** FNV-1a over the edge sequence. */
  const fingerprint = (edges: readonly (readonly number[])[]) => edges.flat().reduce((hash, value) => Math.imul(hash ^ value, 16777619) >>> 0, 2166136261);

  it("has Blender's edges, in the web's first-use order", () => {
    expect(faces.length).toBeGreaterThanOrEqual(1000);
    expect(offset).toBe(corners.length);
    const key = ([a, b]: readonly number[]) => `${a},${b}`;
    expect(ours.map(key).sort()).toEqual(blender.map(key).sort());
    expect({ count: ours.length, first: ours.slice(0, 4), fingerprint: fingerprint(ours) }).toEqual(PINNED_ORDER);
    // The orders do differ here (Blender's 8-map split); the merge input order follows the web's.
    expect(fingerprint(ours)).not.toBe(fingerprint(blender));
  });
});
