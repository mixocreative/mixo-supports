import { describe, expect, it } from 'vitest';
import { weld_positions_in_place as weldWasm } from '../../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js';
import { weldPositions } from '../core/import/weld';

const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function expectParity(raw: Float32Array, indices: Uint32Array, matrix = identity): void {
  const jsInput = raw.slice();
  const wasmInput = raw.slice();
  const expected = weldPositions(jsInput, indices.length > 0 ? indices : undefined, matrix);
  const result = weldWasm(wasmInput, indices, matrix);
  try {
    const positions = result.take_positions();
    const weldedIndices = result.take_indices();
    expect(new Uint32Array(positions.buffer)).toEqual(new Uint32Array(expected.positions.buffer));
    expect(weldedIndices).toEqual(expected.indices);
    expect(new Uint32Array(wasmInput.buffer)).toEqual(new Uint32Array(jsInput.buffer));
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
    expectParity(raw, new Uint32Array([6, 4, 3, 0, 1, 2, 5, 6, 0]));
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
    expectParity(raw, indices, matrix);
  });

  it('matches an unindexed mesh with rounded, near-duplicate points', () => {
    const raw = new Float32Array(900);
    for (let i = 0; i < raw.length; i += 1) raw[i] = Math.fround(Math.round((i % 33) * 0.13) / 10 + (i % 5) * 0.00003);
    expectParity(raw, new Uint32Array());
  });
});
