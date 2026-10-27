import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

// Microbenchmark only: it excludes STL parse, weld, pick-index build and UI work.
const require = createRequire(import.meta.url);
const { center_positions_in_place: centerWasm } = require('../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js');
const file = readFileSync(new URL('../docs/dental-reference/reference-aligner.stl', import.meta.url));
const triangles = file.readUInt32LE(80);
assert.equal(file.length, 84 + 50 * triangles, 'benchmark fixture must be binary STL');
const count = Math.min(187_000, triangles * 3);
const source = new Float32Array(count * 3);
for (let vertex = 0; vertex < count; vertex += 1) {
  const corner = Math.floor(vertex * (triangles * 3) / count);
  const offset = 84 + Math.floor(corner / 3) * 50 + 12 + (corner % 3) * 12;
  for (let axis = 0; axis < 3; axis += 1) source[vertex * 3 + axis] = file.readFloatLE(offset + axis * 4);
}

function centerJs(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 1) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis], positions[i]);
    max[axis] = Math.max(max[axis], positions[i]);
  }
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  for (let i = 0; i < positions.length; i += 1) positions[i] -= center[i % 3];
  return [...center, ...min, ...max];
}

const a = source.slice();
const b = source.slice();
assert.deepEqual(Array.from(centerWasm(a)), centerJs(b));
assert.deepEqual(new Uint8Array(a.buffer), new Uint8Array(b.buffer));

function sample(fn) {
  const positions = source.slice();
  const start = performance.now();
  const metadata = fn(positions);
  const elapsed = performance.now() - start;
  assert.equal(metadata.length, 9);
  assert.ok(Number.isFinite(positions[0]));
  return elapsed;
}
function summary(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], rangeMs: [sorted[0], sorted.at(-1)] };
}

for (let i = 0; i < 2; i += 1) {
  sample(centerJs);
  sample(centerWasm);
}
const js = [];
const wasm = [];
for (let i = 0; i < 7; i += 1) {
  if (i % 2 === 0) {
    js.push(sample(centerJs));
    wasm.push(sample(centerWasm));
  } else {
    wasm.push(sample(centerWasm));
    js.push(sample(centerJs));
  }
}
console.log(JSON.stringify({ vertices: count, bytes: source.byteLength, runsPerSide: 7,
  excludesInputCopy: true, js: summary(js), wasm: summary(wasm) }));
