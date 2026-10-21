import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../analysis/types';
import { refineForOverlay, zoneOverlay } from './overlayMesh';

/** A 100 mm square of two triangles in the xy plane. */
const square: TriangleMesh = {
  positions: new Float32Array([0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 100, 0]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};

/** A closed tetrahedron, 20 mm edges along the axes. */
const tetrahedron: TriangleMesh = {
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 0, 0, 0, 20]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
};

function longestEdge(mesh: TriangleMesh): number {
  let longest = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.indices[t + k]! * 3;
      const b = mesh.indices[t + ((k + 1) % 3)]! * 3;
      longest = Math.max(longest, Math.hypot(p[a]! - p[b]!, p[a + 1]! - p[b + 1]!, p[a + 2]! - p[b + 2]!));
    }
  }
  return longest;
}

/** How many triangles use each undirected edge. */
function edgeUse(mesh: TriangleMesh): Map<string, number> {
  const use = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.indices[t + k]!;
      const b = mesh.indices[t + ((k + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return use;
}

/** Total area and the summed normal of a mesh (orientation check). */
function areaAndNormal(mesh: TriangleMesh): { area: number; normal: [number, number, number] } {
  const p = mesh.positions;
  const normal: [number, number, number] = [0, 0, 0];
  let area = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
    const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    area += Math.hypot(n[0]!, n[1]!, n[2]!) / 2;
    for (let k = 0; k < 3; k++) normal[k]! += n[k]! / 2;
  }
  return { area, normal };
}

describe('refineForOverlay', () => {
  it('brings every edge of a coarse square under the bound', () => {
    const refined = refineForOverlay(square, 1, 1_000_000);
    expect(longestEdge(refined)).toBeLessThanOrEqual(1 + 1e-6);
    const { area, normal } = areaAndNormal(refined);
    expect(area).toBeCloseTo(10000, 3);
    expect(normal[2]).toBeCloseTo(10000, 3);
  });

  it('keeps the original vertices first and unchanged', () => {
    const refined = refineForOverlay(square, 10, 1_000_000);
    expect([...refined.positions.subarray(0, square.positions.length)]).toEqual([...square.positions]);
  });

  it('stops at the triangle budget', () => {
    const refined = refineForOverlay(square, 1, 100);
    const triangles = refined.indices.length / 3;
    expect(triangles).toBeLessThanOrEqual(100);
    expect(triangles).toBeGreaterThan(50);
    expect(longestEdge(refined)).toBeLessThan(longestEdge(square));
  });

  it('leaves no cracks: a closed mesh stays closed', () => {
    const refined = refineForOverlay(tetrahedron, 3, 1_000_000);
    expect(longestEdge(refined)).toBeLessThanOrEqual(3 + 1e-6);
    expect([...edgeUse(refined).values()].every((count) => count === 2)).toBe(true);
    expect(areaAndNormal(refined).area).toBeCloseTo(areaAndNormal(tetrahedron).area, 3);
  });

  it('returns a mesh that already fits unchanged', () => {
    expect(refineForOverlay(tetrahedron, 50, 1_000_000)).toBe(tetrahedron);
  });

  it('splits an edge shared by more than 255 faces in every one of them', () => {
    // A fan of 300 triangles around the 10 mm edge 0-1; every other edge is about 5 mm.
    const fan = 300;
    const positions = [0, 0, 0, 10, 0, 0];
    const indices: number[] = [];
    for (let k = 0; k < fan; k++) {
      const angle = (2 * Math.PI * k) / fan;
      positions.push(5, 0.5 * Math.cos(angle), 0.5 * Math.sin(angle));
      indices.push(0, 1, 2 + k);
    }
    const mesh: TriangleMesh = { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
    const refined = refineForOverlay(mesh, 6, 1_000_000);
    expect(refined.indices.length).toBe(fan * 2 * 3);
    expect(longestEdge(refined)).toBeLessThanOrEqual(6);
    // No triangle left as zeros at the end of a too-short buffer.
    for (let t = 0; t < refined.indices.length; t += 3) {
      const [a, b, c] = [refined.indices[t]!, refined.indices[t + 1]!, refined.indices[t + 2]!];
      expect(a !== b && b !== c && a !== c).toBe(true);
    }
  });
});

describe('zoneOverlay', () => {
  it('refines and grids a mesh once per mesh object', () => {
    const first = zoneOverlay(square, 10, 1_000_000, 2);
    expect(zoneOverlay(square, 10, 1_000_000, 2)).toBe(first);
    expect(longestEdge(first.mesh)).toBeLessThanOrEqual(10);
    expect(first.grid!.cellVertices.length).toBe(first.mesh.positions.length / 3);
    // A copy of the same data is another mesh object: worked out anew.
    const copy: TriangleMesh = { positions: square.positions.slice(), indices: square.indices.slice() };
    expect(zoneOverlay(copy, 10, 1_000_000, 2)).not.toBe(first);
  });

  it('shares a mesh that already fits', () => {
    expect(zoneOverlay(tetrahedron, 50, 1_000_000, 2).mesh).toBe(tetrahedron);
  });
});
