import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AsciiStlSession, BinaryStlSession } from '../../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js';
import { binaryStlTriangles, StlWelder } from '../core/import/stl';

describe('Rust/WASM streaming binary STL parity', () => {
  it('matches the saved aligner vertex and index buffers bit-for-bit across uneven chunks', () => {
    const file = readFileSync('docs/dental-reference/reference-aligner.stl');
    const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
    const head = bytes.subarray(0, 84);
    const expected = new StlWelder(head, bytes.length);
    const actual = new BinaryStlSession(binaryStlTriangles(head, bytes.length));
    try {
      for (let offset = 0; offset < bytes.length; offset += 1_000_003) {
        const chunk = bytes.subarray(offset, offset + 1_000_003);
        expected.push(chunk);
        actual.push(chunk);
      }
      const oldMesh = expected.finish();
      const newMesh = actual.finish();
      try {
        const positions = newMesh.take_positions();
        const indices = newMesh.take_indices();
        expect(new Uint32Array(positions.buffer)).toEqual(new Uint32Array(oldMesh.positions.buffer));
        expect(indices).toEqual(oldMesh.indices);
      } finally {
        newMesh.free();
      }
    } finally {
      actual.free();
    }
  });
});

describe('Rust/WASM streaming ASCII STL parity', () => {
  it('matches a multiline vertex when both lines arrive in one chunk', () => {
    const bytes = new TextEncoder().encode('solid x\nvertex 0\n 0 0\nvertex 1 0 0\nvertex 0 0 1\n');
    const expected = new StlWelder(bytes.subarray(0, 84), bytes.length);
    expected.push(bytes);
    const actual = new AsciiStlSession(bytes.length);
    try {
      actual.push(bytes);
      const oldMesh = expected.finish();
      const newMesh = actual.finish();
      try {
        expect(new Uint32Array(newMesh.take_positions().buffer)).toEqual(new Uint32Array(oldMesh.positions.buffer));
        expect(newMesh.take_indices()).toEqual(oldMesh.indices);
      } finally {
        newMesh.free();
      }
    } finally {
      actual.free();
    }
  });

  it('matches legacy vertex and index bytes across split lines and an unterminated final line', () => {
    const bytes = new TextEncoder().encode([
      'solid aligner',
      'facet normal 0 0 1',
      'outer loop',
      'vertex 0 0 0',
      'vertex 1.25 0 0',
      'vertex 0 0 1e0',
      'endloop',
      'endfacet',
      'facet normal 0 0 1',
      'outer loop',
      'vertex 1.25 0 0',
      'vertex 0 0 1e0',
      'vertex -0.125 2.5 0',
      'endloop',
      'endfacet',
      'endsolid aligner',
    ].join('\n'));
    const expected = new StlWelder(bytes.subarray(0, 84), bytes.length);
    const actual = new AsciiStlSession(bytes.length);
    try {
      for (let offset = 0; offset < bytes.length; offset += 7) {
        const chunk = bytes.subarray(offset, offset + 7);
        expected.push(chunk);
        actual.push(chunk);
      }
      const oldMesh = expected.finish();
      const newMesh = actual.finish();
      try {
        expect(new Uint32Array(newMesh.take_positions().buffer)).toEqual(new Uint32Array(oldMesh.positions.buffer));
        expect(newMesh.take_indices()).toEqual(oldMesh.indices);
      } finally {
        newMesh.free();
      }
    } finally {
      actual.free();
    }
  });
});
