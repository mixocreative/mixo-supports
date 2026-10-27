import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Matrix4, TorusKnotGeometry } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TriangleMesh } from '../core/analysis/types';
import { parseStl, weldPositions } from '../../scripts/test-support/rustImport';
import { StlWelder } from '../../scripts/test-support/ts-oracle/stl';

/*
 * The typed-array import (src/core/import) must give exactly what the three.js path gave before it:
 * STLLoader, rotateX(-PI/2) and mergeVertices(1e-4), vertex for vertex and index for index.
 */

/** The previous import, kept here as the reference. */
function threeWeld(geometry: BufferGeometry): TriangleMesh {
  const positionsOnly = new BufferGeometry();
  positionsOnly.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) positionsOnly.setIndex(geometry.index.clone());
  const welded = mergeVertices(positionsOnly, 1e-4);
  return { positions: new Float32Array(welded.getAttribute('position').array), indices: new Uint32Array(welded.index!.array) };
}
function threeStl(buffer: ArrayBuffer): TriangleMesh {
  return threeWeld(new STLLoader().parse(buffer).rotateX(-Math.PI / 2));
}

/** Deterministic pseudo-random numbers. */
function random(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function binaryStl(soup: Float32Array): ArrayBuffer {
  const triangles = soup.length / 9;
  const view = new DataView(new ArrayBuffer(84 + triangles * 50));
  view.setUint32(80, triangles, true);
  for (let t = 0; t < triangles; t += 1) {
    for (let k = 0; k < 9; k += 1) view.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k]!, true);
  }
  return view.buffer;
}

function asciiStl(soup: Float32Array): ArrayBuffer {
  const lines = ['solid test'];
  for (let t = 0; t < soup.length / 9; t += 1) {
    lines.push(' facet normal 0 0 1', '  outer loop');
    for (let v = 0; v < 3; v += 1) lines.push(`   vertex ${soup[t * 9 + v * 3]} ${soup[t * 9 + v * 3 + 1]!.toExponential(6)} ${soup[t * 9 + v * 3 + 2]}`);
    lines.push('  endloop', ' endfacet');
  }
  lines.push('endsolid test');
  return new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer;
}

/** A triangle soup from a three geometry, plus jittered copies of its vertices around the weld tolerance. */
function soupOf(geometry: BufferGeometry, jitter: number, seed = 1): Float32Array {
  const next = random(seed);
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = flat.getAttribute('position').array as Float32Array;
  return positions.map((value) => value + (next() < 0.3 ? (next() - 0.5) * jitter : 0));
}

function expectSame(actual: TriangleMesh, expected: TriangleMesh): void {
  expect(actual.indices.length).toBe(expected.indices.length);
  expect(actual.positions.length).toBe(expected.positions.length);
  // Bit for bit (toEqual on floats would let -0 equal 0).
  expect(new Uint32Array(actual.positions.slice().buffer)).toEqual(new Uint32Array(expected.positions.slice().buffer));
  expect(actual.indices).toEqual(expected.indices);
}

describe('typed-array weld matches three mergeVertices', () => {
  it('binary STL of a knot, exact and with jitter around the 1e-4 tolerance', () => {
    for (const jitter of [0, 2e-4, 5e-5]) {
      const buffer = binaryStl(soupOf(new TorusKnotGeometry(10, 3, 120, 16), jitter));
      expectSame(parseStl(buffer), threeStl(buffer));
    }
  });

  it('binary STL fed in odd-sized chunks', () => {
    const buffer = binaryStl(soupOf(new TorusKnotGeometry(10, 3, 64, 8), 1e-4, 7));
    const bytes = new Uint8Array(buffer);
    const welder = new StlWelder(bytes.subarray(0, 84), bytes.length);
    for (let offset = 0; offset < bytes.length; offset += 997) welder.push(bytes.subarray(offset, offset + 997));
    expectSame(welder.finish(), threeStl(buffer));
  });

  it('binary STL with trailing padding (header count read, tail ignored, as STLLoader)', () => {
    const exact = new Uint8Array(binaryStl(soupOf(new TorusKnotGeometry(10, 3, 32, 6), 0)));
    const padded = new Uint8Array(exact.length + 13);
    padded.set(exact);
    expectSame(parseStl(padded.buffer), threeStl(padded.buffer));
  });

  it('edge cases: signed zeros, tiny negatives, duplicate and degenerate triangles, int32 wrap, table growth', () => {
    const next = random(5);
    const triangles: number[][] = [
      [0, 0, 0, -0, 0, 1, 1, -0, 0],
      [-0.00004, 0, 0, 0, -0.00009, 1, 1, 0, -0.00001],
      [0, 0, 0, -0, 0, 1, 1, -0, 0], // duplicate
      [2, 2, 2, 2, 2, 2, 3, 3, 3], // degenerate (two equal corners)
      [214_748.4, 1, 1, 214_749, 1, 1, -300_000, 5, 5], // ~~ wraps past int32 the same way in both
    ];
    // Many distinct vertices: the weld table grows past its first size.
    for (let t = 0; t < 4000; t += 1) triangles.push(Array.from({ length: 9 }, () => (next() - 0.5) * 100));
    const buffer = binaryStl(new Float32Array(triangles.flat()));
    expectSame(parseStl(buffer), threeStl(buffer));
  });

  it('ASCII STL', () => {
    const buffer = asciiStl(soupOf(new TorusKnotGeometry(10, 3, 40, 8), 2e-4, 3));
    expectSame(parseStl(buffer), threeStl(buffer));
  });

  it('indexed glTF-style mesh with a world matrix (transformed in place)', () => {
    const geometry = new TorusKnotGeometry(8, 2, 50, 10);
    const matrix = new Matrix4().makeRotationY(0.7).setPosition(3, -2, 11.5).scale({ x: 1.5, y: 1.5, z: 1.5 } as never);
    const reference = geometry.clone().applyMatrix4(matrix);
    const positions = new Float32Array(geometry.getAttribute('position').array);
    const indices = Uint32Array.from(geometry.index!.array);
    expectSame(weldPositions(positions, indices, matrix.toArray()), threeWeld(reference));
  });

  it('unindexed raw positions with near-duplicates', () => {
    const next = random(11);
    const positions = new Float32Array(3 * 3000).map(() => Math.round(next() * 20) / 10 + (next() - 0.5) * 3e-4);
    const reference = new BufferGeometry();
    reference.setAttribute('position', new BufferAttribute(positions.slice(), 3));
    expectSame(weldPositions(positions.slice()), threeWeld(reference));
  });
});
