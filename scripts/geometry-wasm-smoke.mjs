import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packagePath = new URL('../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js', import.meta.url);
const packageFile = fileURLToPath(packagePath);
assert.ok(existsSync(packageFile), 'Node WASM package must be built before its smoke test');

const require = createRequire(import.meta.url);
const { engine_version: engineVersion, GeometrySession } = require(packageFile);
assert.equal(engineVersion(), 1, 'Node WASM and host must agree on the geometry schema');

const session = new GeometrySession(48);
const handle = session.load_mesh(
  new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  new Uint32Array([0, 1, 2]),
);
assert.deepEqual(Array.from(session.mesh_bounds(handle)), [0, 0, 0, 2, 3, 0]);
assert.equal(session.used_bytes(), 48);
session.release_mesh(handle);
assert.equal(session.used_bytes(), 0);
assert.throws(() => session.mesh_bounds(handle), /InvalidHandle/);
assert.throws(() => session.load_mesh(new Float32Array([0, 1]), new Uint32Array([0, 1, 2])), /InvalidLength/);
assert.throws(() => session.load_mesh(new Float32Array([0, 0, NaN]), new Uint32Array([0, 0, 0])), /NonFinite/);
assert.throws(() => session.load_mesh(new Float32Array([0, 0, 0]), new Uint32Array([0, 0, 1])), /InvalidIndex/);
session.free();

const limited = new GeometrySession(47);
assert.throws(() => limited.load_mesh(
  new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  new Uint32Array([0, 1, 2]),
), /Capacity/);
assert.equal(limited.used_bytes(), 0);
limited.free();
