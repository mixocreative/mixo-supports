import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packagePath = new URL('../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js', import.meta.url);
const packageFile = fileURLToPath(packagePath);
assert.ok(existsSync(packageFile), 'Node WASM package must be built before its smoke test');

const require = createRequire(import.meta.url);
const { engine_version: engineVersion, GeometrySession, center_positions_in_place: centerPositionsInPlace,
  weld_positions_in_place: weldPositionsInPlace, decimate_display: decimateDisplay, BinaryStlSession } = require(packageFile);
assert.equal(engineVersion(), 1, 'Node WASM and host must agree on the geometry schema');

const shifted = new Float32Array([8, -2, 4, 12, 4, 6]);
assert.deepEqual(Array.from(centerPositionsInPlace(shifted)), [10, 1, 5, 8, -2, 4, 12, 4, 6]);
assert.deepEqual(Array.from(shifted), [-2, -3, -1, 2, 3, 1]);
const invalidCenter = new Float32Array([1, NaN, 3]);
assert.throws(() => centerPositionsInPlace(invalidCenter), { code: 'NON_FINITE' });
assert.equal(invalidCenter[0], 1);
assert.ok(Number.isNaN(invalidCenter[1]));

const weldInput = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0]);
const welded = weldPositionsInPlace(weldInput, new Uint32Array([2, 1, 0]),
  new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1]));
assert.deepEqual(Array.from(weldInput), [3, 0, 0, 4, 0, 0, 3, 0, 0]);
assert.deepEqual(Array.from(welded.take_positions()), [3, 0, 0, 4, 0, 0]);
assert.deepEqual(Array.from(welded.take_indices()), [0, 1, 0]);
welded.free();
assert.throws(() => weldPositionsInPlace(new Float32Array([0, 0, 0]), new Uint32Array([1, 1, 1]),
  new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])), { code: 'INVALID_INDEX' });
assert.throws(() => weldPositionsInPlace(new Float32Array([1, 0, 0]), new Uint32Array(),
  new Float64Array([1e40, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])), { code: 'NON_FINITE' });

const display = decimateDisplay(new Float32Array([0, 0, 0, 0.01, 0, 0, 1, 0, 0, 0, 1, 0]),
  new Uint32Array([0, 1, 2, 0, 2, 3]), 1);
assert.ok(display.take_indices().length <= 3);
display.free();
assert.throws(() => decimateDisplay(new Float32Array([NaN, 0, 0]), new Uint32Array([0, 0, 0]), 1), { code: 'NON_FINITE' });

const binaryStl = new Uint8Array(134);
const stlView = new DataView(binaryStl.buffer);
stlView.setUint32(80, 1, true);
[0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((value, index) => stlView.setFloat32(96 + index * 4, value, true));
const stream = new BinaryStlSession(1);
for (let offset = 0; offset < binaryStl.length; offset += 17) stream.push(binaryStl.subarray(offset, offset + 17));
const stlMesh = stream.finish();
assert.deepEqual(Array.from(stlMesh.take_indices()), [0, 1, 2]);
assert.equal(stlMesh.take_positions()[7], 1);
stlMesh.free();
assert.throws(() => stream.finish(), { code: 'INVALID_HANDLE' });
stream.free();
const shortStl = new BinaryStlSession(1);
shortStl.push(binaryStl.subarray(0, binaryStl.length - 1));
assert.throws(() => shortStl.finish(), { code: 'BAD_STL' });
shortStl.free();
const emptyStl = new BinaryStlSession(0);
emptyStl.push(new Uint8Array(84));
assert.throws(() => emptyStl.finish(), { code: 'NO_MESH' });
emptyStl.free();

const session = new GeometrySession(48);
const handle = session.load_mesh(
  new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  new Uint32Array([0, 1, 2]),
);
assert.deepEqual(Array.from(session.mesh_bounds(handle)), [0, 0, 0, 2, 3, 0]);
assert.equal(session.used_bytes(), 48);
session.release_mesh(handle);
assert.equal(session.used_bytes(), 0);
assert.throws(() => session.mesh_bounds(handle), { code: 'INVALID_HANDLE' });
assert.throws(() => session.release_mesh(handle), { code: 'INVALID_HANDLE' });
assert.throws(() => session.load_mesh(new Float32Array([0, 1]), new Uint32Array([0, 1, 2])), { code: 'INVALID_LENGTH' });
assert.throws(() => session.load_mesh(new Float32Array([0, 0, NaN]), new Uint32Array([0, 0, 0])), { code: 'NON_FINITE' });
assert.throws(() => session.load_mesh(new Float32Array([0, 0, 0]), new Uint32Array([0, 0, 1])), { code: 'INVALID_INDEX' });
session.free();

const limited = new GeometrySession(47);
assert.throws(() => limited.load_mesh(
  new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  new Uint32Array([0, 1, 2]),
), { code: 'CAPACITY' });
assert.equal(limited.used_bytes(), 0);
limited.free();
