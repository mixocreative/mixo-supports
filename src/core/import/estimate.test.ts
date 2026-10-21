import { describe, expect, it } from 'vitest';
import { estimateTriangles, ESTIMATE_HEAD_BYTES } from './estimate';

function binaryHead(triangles: number, headerCount = triangles): Uint8Array {
  const head = new Uint8Array(84);
  new DataView(head.buffer).setUint32(80, headerCount, true);
  return head;
}

function asciiStl(triangles: number): Uint8Array {
  const facet = ' facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\n';
  return new TextEncoder().encode(`solid x\n${facet.repeat(triangles)}endsolid x\n`);
}

function glb(json: object): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(20 + padded).fill(0x20);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length + 1000, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  return out;
}

const scene = {
  scenes: [{ nodes: [0, 1, 2] }],
  nodes: [{ mesh: 0 }, { mesh: 0 }, { mesh: 1 }],
  meshes: [
    { primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
    { primitives: [{ attributes: { POSITION: 2 } }, { attributes: { POSITION: 2 }, mode: 1 }] },
  ],
  accessors: [{ count: 400 }, { count: 600 }, { count: 90 }],
};

describe('estimateTriangles (before parsing)', () => {
  it('binary STL: exact from the file size', () => {
    expect(estimateTriangles(binaryHead(2_000_000), 84 + 2_000_000 * 50, 'big.stl')).toEqual({ triangles: 2_000_000, exact: true });
    // A header count of 0 (some exporters) still gives the size's count.
    expect(estimateTriangles(binaryHead(10, 0), 84 + 10 * 50, 'zero.stl')).toEqual({ triangles: 10, exact: true });
  });

  it('ASCII STL: exact when the head is the whole file, else bytes per facet from the head', () => {
    const file = asciiStl(1000);
    expect(estimateTriangles(file, file.length, 'small.stl')).toEqual({ triangles: 1000, exact: true });
    const estimate = estimateTriangles(file.subarray(0, 4000), file.length, 'big.stl')!;
    expect(estimate.exact).toBe(false);
    expect(Math.abs(estimate.triangles - 1000) / 1000).toBeLessThan(0.05);
  });

  it('GLB and glTF: triangle primitives per node instance, from the JSON alone', () => {
    // 2 nodes x 200 indexed triangles + 30 unindexed (the line primitive does not count).
    expect(estimateTriangles(glb(scene), 5_000_000, 'scene.glb')).toEqual({ triangles: 430, exact: true });
    const text = new TextEncoder().encode(JSON.stringify(scene));
    expect(estimateTriangles(text, text.length, 'scene.gltf')).toEqual({ triangles: 430, exact: true });
  });

  it('unknown when the head does not hold what it needs', () => {
    const text = new TextEncoder().encode(JSON.stringify(scene));
    expect(estimateTriangles(text.subarray(0, 20), text.length, 'scene.gltf')).toBeNull();
    expect(estimateTriangles(new Uint8Array(10), 10, 'x.obj')).toBeNull();
    expect(ESTIMATE_HEAD_BYTES).toBeGreaterThanOrEqual(1 << 20);
  });
});
