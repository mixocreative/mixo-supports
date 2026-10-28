import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packagePath = new URL('../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js', import.meta.url);
const packageFile = fileURLToPath(packagePath);
assert.ok(existsSync(packageFile), 'Node WASM package must be built before its smoke test');

const require = createRequire(import.meta.url);
const { engine_version: engineVersion, GeometrySession, center_positions_in_place: centerPositionsInPlace,
  weld_positions_in_place: weldPositionsInPlace, zoned_at: zonedAt, decimate_display: decimateDisplay, BinaryStlSession, AsciiStlSession } = require(packageFile);
assert.equal(engineVersion(), 6, 'Node WASM and host must agree on the geometry schema');

// The stamp rule behind no-support zones: [centre xyz, normal xyz, radius, 1 paint / 0 erase], the last covering stamp wins.
const paint = [0, 0, 0, 0, -1, 0, 2, 1];
const erase = [0, 0, 0, 0, -1, 0, 1, 0];
assert.equal(zonedAt(new Float64Array(paint), new Float64Array([1.5, 0, 0]), new Float64Array([0, -1, 0])), true);
assert.equal(zonedAt(new Float64Array([...paint, ...erase]), new Float64Array([0.5, 0, 0]), new Float64Array(0)), false);
assert.equal(zonedAt(new Float64Array(paint), new Float64Array([0, 0, 0]), new Float64Array([0, 1, 0])), false);
assert.throws(() => zonedAt(new Float64Array(paint), new Float64Array([0, 0]), new Float64Array(0)), { code: 'INVALID_LENGTH' });

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

const asciiBytes = new TextEncoder().encode('solid x\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 0 1\nendsolid x');
const asciiStream = new AsciiStlSession(asciiBytes.length);
for (let offset = 0; offset < asciiBytes.length; offset += 5) asciiStream.push(asciiBytes.subarray(offset, offset + 5));
const asciiMesh = asciiStream.finish();
assert.deepEqual(Array.from(asciiMesh.take_indices()), [0, 1, 2]);
asciiMesh.free();
assert.throws(() => asciiStream.finish(), { code: 'INVALID_HANDLE' });
asciiStream.free();
const emptyAscii = new AsciiStlSession(10);
emptyAscii.push(new TextEncoder().encode('solid x'));
assert.throws(() => emptyAscii.finish(), { code: 'NO_MESH' });
emptyAscii.free();
const shortAscii = new AsciiStlSession(20);
shortAscii.push(new TextEncoder().encode('solid x\nvertex 0 0 0'));
assert.throws(() => shortAscii.finish(), { code: 'BAD_STL' });
shortAscii.free();

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

// Dental ABI: session-handle calls, a profile named on every call, typed errors, abstention on a
// cube, Rust-made policies; the internals and the profile list exist in this (test-abi) package only.
{
  const dental = require(packageFile);
  const cube = {
    positions: new Float32Array([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
  };
  assert.deepEqual(dental.dental_profile_ids(), ['reference-aligner']);
  assert.equal(dental.PolicyData, undefined, 'the host cannot assemble a policy');
  const session = new dental.GeometrySession(1 << 20);
  const model = session.load_mesh(cube.positions, cube.indices);
  assert.throws(() => session.orient_dental(model, 'nope'), { code: 'UNKNOWN_PROFILE' });
  assert.throws(() => session.propose_dental_region(model, new Float64Array([0.2, 1]), 'reference-aligner'), { code: 'INVALID_LENGTH' });
  const oriented = session.orient_dental(model, 'reference-aligner');
  assert.equal(oriented.status(), 1, 'a cube has no cavity: orientation fails instead of inventing one');
  oriented.free();
  const region = session.propose_dental_region(model, new Float64Array([0.2, 1, 1]), 'reference-aligner');
  assert.equal(region.ok(), false);
  assert.match(region.reason(), /^orientation-/);
  region.free();
  const none = new Uint8Array(), noEdges = new Uint32Array(), still = new Float64Array(6), both = Uint8Array.of(1, 1);
  assert.throws(() => session.dental_policy(model, 'nope', 2, new Float64Array([0.2, 1, 1]), new Float64Array(), none, none, noEdges, noEdges, both, still), { code: 'UNKNOWN_PROFILE' });
  const closed = session.dental_policy(model, 'reference-aligner', 2, new Float64Array([0.2, 1, 1]), new Float64Array(), new Uint8Array(12), none, noEdges, noEdges, both, still);
  assert.equal(closed.reproduced(), false, 'a saved area detection does not reproduce permits nothing');
  assert.equal(closed.candidate_ids().length, 0);
  assert.equal(closed.automatic(), 1);
  assert.deepEqual(Array.from(closed.structures()), [1, 1, 1, 0, 0, 1]);
  assert.equal(closed.profile_id(), 'reference-aligner');
  closed.free();
  const painted = session.dental_policy(model, 'reference-aligner', 1, new Float64Array([0.2, 1, 1]), new Float64Array([0, -1, 0, 5, 0, -1, 0, 1]), none, none, noEdges, noEdges, both, still);
  assert.equal(painted.automatic(), 0, 'a painted area permits its own fill contacts');
  assert.equal(painted.landing_rule(), 1);
  assert.ok(Array.from(painted.permitted_faces()).some((f) => f === 1));
  painted.free();
  session.free();
  assert.deepEqual(Array.from(dental.manual_dental_area(4, new Uint32Array([1, 2]), false, 'reference-aligner')), [0, 1, 1, 0]);
  assert.throws(() => dental.manual_dental_area(4, new Uint32Array([1]), true, 'reference-aligner'), { code: 'DETECTED_AREA_EXISTS' });
  assert.throws(() => dental.manual_dental_area(4, new Uint32Array([4]), false, 'reference-aligner'), { code: 'INVALID_INDEX' });
}
