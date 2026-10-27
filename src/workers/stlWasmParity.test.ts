import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { AsciiStlSession, BinaryStlSession } from '../../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js';
import { binaryStlTriangles } from '../core/import/stlHeader';
import { exactArray, expectGolden } from '../../scripts/test-support/golden';

/* Expected arrays were recorded from the TS StlWelder (U9): scripts/fixtures/golden/import-stl-*.json. */
type Finished = { take_positions(): Float32Array; take_indices(): Uint32Array };
const plainMesh = (mesh: Finished) => ({ positions: Array.from(mesh.take_positions()), indices: Array.from(mesh.take_indices()) });

describe('Rust/WASM streaming binary STL parity', () => {
  it('matches the saved aligner vertex and index buffers bit-for-bit across uneven chunks', () => {
    const file = readFileSync('docs/dental-reference/reference-aligner.stl');
    const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
    const head = bytes.subarray(0, 84);
    const actual = new BinaryStlSession(binaryStlTriangles(head, bytes.length));
    try {
      for (let offset = 0; offset < bytes.length; offset += 1_000_003) actual.push(bytes.subarray(offset, offset + 1_000_003));
      const newMesh = actual.finish();
      try {
        expectGolden('import-stl-aligner', { positions: exactArray(newMesh.take_positions(), 'f32'), indices: exactArray(newMesh.take_indices()) });
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
    const actual = new AsciiStlSession(bytes.length);
    try {
      actual.push(bytes);
      const newMesh = actual.finish();
      try {
        expectGolden('import-stl-ascii-multiline', plainMesh(newMesh));
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
    const actual = new AsciiStlSession(bytes.length);
    try {
      for (let offset = 0; offset < bytes.length; offset += 7) actual.push(bytes.subarray(offset, offset + 7));
      const newMesh = actual.finish();
      try {
        expectGolden('import-stl-ascii-split', plainMesh(newMesh));
      } finally {
        newMesh.free();
      }
    } finally {
      actual.free();
    }
  });
});
