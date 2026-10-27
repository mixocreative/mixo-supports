import { describe, expect, it } from 'vitest';
import { weld_positions_in_place as weldWasm } from '../../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js';
import { exactArray, expectGolden } from '../../scripts/test-support/golden';

const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Rust welded arrays and the in-place transformed input against the TS welder's recording (bit for bit). */
function expectParity(name: string, raw: Float32Array, indices: Uint32Array, matrix = identity): void {
  const input = raw.slice();
  const result = weldWasm(input, indices, matrix);
  try {
    expectGolden(`import-weld-${name}`, {
      positions: exactArray(result.take_positions(), 'f32'),
      indices: exactArray(result.take_indices()),
      input: exactArray(input, 'f32'),
    });
  } finally {
    result.free();
  }
}

describe('Rust/WASM weld parity with the existing import contract', () => {
  it('keeps first-seen indexed order, near-duplicates and int32 quantisation wrap', () => {
    const raw = new Float32Array([
      0, 0, 0, -0, 0, 0, 1, 2, 3, 1.00001, 2, 3,
      214_748.4, 1, 1, 214_749, 1, 1, -300_000, 5, 5,
    ]);
    expectParity('first-seen', raw, new Uint32Array([6, 4, 3, 0, 1, 2, 5, 6, 0]));
  });

  it('matches a transformed, indexed mesh with many repeated corners', () => {
    const raw = new Float32Array(3000);
    for (let i = 0; i < raw.length; i += 1) raw[i] = Math.fround((i % 71) * 0.137 - 4);
    const indices = new Uint32Array(raw.length);
    for (let i = 0; i < indices.length; i += 1) indices[i] = (i * 37) % (raw.length / 3);
    const matrix = new Float64Array([
      1.2, 0.1, 0, 0, -0.2, 0.9, 0.3, 0, 0.05, -0.1, 1.1, 0,
      3.25, -2.5, 11.125, 1,
    ]);
    expectParity('transformed', raw, indices, matrix);
  });

  it('matches an unindexed mesh with rounded, near-duplicate points', () => {
    const raw = new Float32Array(900);
    for (let i = 0; i < raw.length; i += 1) raw[i] = Math.fround(Math.round((i % 33) * 0.13) / 10 + (i % 5) * 0.00003);
    expectParity('unindexed', raw, new Uint32Array());
  });
});
