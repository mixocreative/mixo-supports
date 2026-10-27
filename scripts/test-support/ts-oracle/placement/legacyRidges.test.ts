import { describe, expect, it } from 'vitest';
import { legacyRidgeMidpoints, meshEdges, signedEdgeAngles } from './legacyRidges';

type Vector = [number, number, number];

describe('legacy ridges', () => {
  it('orders edges by first use, each loop from its closing edge', () => {
    expect(meshEdges([[0, 1, 2], [2, 1, 3]])).toEqual([[0, 2], [0, 1], [1, 2], [2, 3], [1, 3]]);
  });

  // Two triangles hinged on the x axis (edge 0-1), Z up.
  const ridge = (z: number): Vector[] => [[0, 0, 0], [1, 0, 0], [0.5, 1, z], [0.5, -1, z]];
  const faces = [[0, 1, 2], [1, 0, 3]];

  it('signs the dihedral angle: positive where convex, negative where concave', () => {
    const edge = meshEdges(faces).findIndex(([a, b]) => a === 0 && b === 1);
    const down = signedEdgeAngles(ridge(-1), faces, meshEdges(faces))[edge]!;
    const up = signedEdgeAngles(ridge(1), faces, meshEdges(faces))[edge]!;
    expect(Math.abs(down)).toBeCloseTo(Math.PI / 2, 12);
    expect(Math.sign(down)).toBe(-Math.sign(up));
    expect(signedEdgeAngles(ridge(0), faces, meshEdges(faces))[edge]).toBeCloseTo(0, 12);
  });

  it('emits the midpoint of a sharp edge whose normal faces down', () => {
    const positions = ridge(-1);
    const down: Vector = [0, 0, -1];
    const edges = meshEdges(faces);
    const angles = signedEdgeAngles(positions, faces, edges);
    const sharp = edges.filter((_, e) => angles[e]! > Math.PI / 6);
    expect(sharp.length).toBeGreaterThan(0);
    const normals = positions.map(() => down);
    expect(legacyRidgeMidpoints(positions, faces, normals, 30, 50)).toEqual(sharp.map(([a, b]) => [0, 1, 2].map((axis) => Math.fround((positions[a]![axis]! + positions[b]![axis]!) / 2))));
    // An upward normal fails the overhang test.
    expect(legacyRidgeMidpoints(positions, faces, positions.map(() => [0, 0, 1] as Vector), 30, 50)).toEqual([]);
  });
});
