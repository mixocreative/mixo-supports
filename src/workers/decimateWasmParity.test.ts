import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decimate_display } from '../../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js';
import { decimate } from '../../scripts/test-support/legacyDecimate';
import { parseStl } from '../../scripts/test-support/rustImport';
import { decimateWithWasm } from './prepareImport';

describe('display decimation WASM parity', () => {
  it('matches the existing display grid byte-for-byte', () => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let y = 0; y <= 30; y += 1) {
      for (let x = 0; x <= 30; x += 1) positions.push(x * 0.17, y * 0.21, Math.sin(x * 0.2) * Math.cos(y * 0.3));
    }
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 30; x += 1) {
        const a = y * 31 + x;
        indices.push(a, a + 31, a + 1, a + 31, a + 32, a + 1);
      }
    }
    const mesh = { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
    const expected = decimate(mesh, 350);
    const result = decimate_display(mesh.positions, mesh.indices, 350);
    try {
      expect(new Uint32Array(result.take_positions().buffer)).toEqual(new Uint32Array(expected.positions.buffer));
      expect(result.take_indices()).toEqual(expected.indices);
    } finally {
      result.free();
    }
    const hosted = decimateWithWasm(mesh, { decimate_display }, 350);
    expect(hosted.positions).toEqual(expected.positions);
    expect(hosted.indices).toEqual(expected.indices);
  });

  it('matches the saved aligner at a display-size target', () => {
    const file = readFileSync('docs/dental-reference/reference-aligner.stl');
    const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
    // The Rust import is bit-identical to the old TS welder (golden import-stl-aligner).
    const mesh = parseStl(bytes);
    const expected = decimate(mesh, 20_000);
    const actual = decimateWithWasm(mesh, { decimate_display }, 20_000);
    expect(new Uint32Array(actual.positions.buffer)).toEqual(new Uint32Array(expected.positions.buffer));
    expect(actual.indices).toEqual(expected.indices);
  });
});
