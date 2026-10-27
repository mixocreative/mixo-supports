import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BinaryStlSession } from '../../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js';
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
