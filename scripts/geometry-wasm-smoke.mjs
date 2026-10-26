import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packagePath = new URL('../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js', import.meta.url);
const packageFile = fileURLToPath(packagePath);
assert.ok(existsSync(packageFile), 'Node WASM package must be built before its smoke test');

const require = createRequire(import.meta.url);
const { engine_version: engineVersion } = require(packageFile);
assert.equal(engineVersion(), 1, 'Node WASM and host must agree on the geometry schema');
