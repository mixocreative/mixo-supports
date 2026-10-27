import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');
const env = { ...process.env, PATH: `${cargoBin}${delimiter}${process.env.PATH ?? ''}` };
const wasmPack = join(root, 'node_modules', 'wasm-pack', 'run.js');

// The Node package (tests, review scripts) also carries the dental internals (`test-abi`); the
// browser package is the production ABI only.
for (const [target, output, features] of [['nodejs', 'pkg-node', ['--features', 'test-abi']], ['web', 'pkg-browser', []]]) {
  const result = spawnSync(process.execPath, [
    wasmPack, 'build', 'crates/geometry-wasm', '--target', target,
    '--out-dir', output, '--release', '--', ...features,
  ], { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
