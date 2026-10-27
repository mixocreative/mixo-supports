import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../core/analysis/types';
import { corpus } from '../../scripts/fixtures/stl-corpus/generate';
import { nodeEngine } from '../../scripts/test-support/rustImport';
import { parseStl as oracleParse } from '../../scripts/test-support/ts-oracle/stl';
import { finishStl, openStlSession, pushStl } from './stlSession';

/*
 * U1 odd-STL corpus: the Rust sessions (through the production host glue) must give the TS oracle's
 * exact bytes, or the same typed error code, for every file. Where they disagree on a malformed
 * file the more user-safe result wins and is listed in DISAGREEMENTS with the reason.
 *
 * Found and fixed in Rust: non-ASCII whitespace (NBSP, U+2003, U+3000, vertical tab, BOM) between
 * ASCII tokens was dropped as no-mesh; Rust now accepts the same characters as JS regex \s.
 * Shared behaviour kept on purpose: keywords are lowercase-only (as three's STLLoader), so
 * uppercase VERTEX lines give no-mesh and an all-uppercase SOLID header is classified binary and
 * refused as bad-stl; both are clear errors, never a wrong mesh.
 */
const DIR = 'scripts/fixtures/stl-corpus';
const ON_DISK = Object.keys(import.meta.glob('../../scripts/fixtures/stl-corpus/*.stl')).map((path) => path.split('/').pop()!).sort();
const fileBytes = (name: string) => {
  const file = readFileSync(`${DIR}/${name}`);
  return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
};

type Outcome = { mesh: TriangleMesh } | { code: string };

function run(fn: () => TriangleMesh): Outcome {
  try {
    return { mesh: fn() };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (!code) throw error;
    return { code };
  }
}

/** The Rust path with the file cut into `chunk`-byte pieces (0 = one chunk). */
function rust(bytes: Uint8Array, chunk = 0): TriangleMesh {
  const stream = openStlSession(nodeEngine, bytes.subarray(0, 84), bytes.byteLength);
  try {
    if (chunk === 0) pushStl(stream, bytes, 'corpus');
    else for (let offset = 0; offset < bytes.length; offset += chunk) pushStl(stream, bytes.subarray(offset, offset + chunk), 'corpus');
  } catch (error) {
    stream.free();
    throw error;
  }
  return finishStl(stream, 'corpus');
}

const bits = (mesh: TriangleMesh) => ({ positions: Array.from(new Uint32Array(mesh.positions.slice().buffer)), indices: Array.from(mesh.indices) });

/** Files where Rust and the oracle differ on purpose: name -> [oracle outcome code, rust outcome code, reason]. */
const DISAGREEMENTS: Record<string, [string, string, string]> = {};

describe('odd-STL corpus: committed files are what the generator makes', () => {
  it('matches generate.ts byte for byte and has no stray files', () => {
    const expected = corpus();
    expect(ON_DISK).toEqual(Object.keys(expected).sort());
    for (const [name, bytes] of Object.entries(expected)) expect(fileBytes(name), name).toEqual(bytes);
  });
});

describe('odd-STL corpus: Rust equals the TS oracle', () => {
  for (const name of Object.keys(corpus()).sort()) {
    it(name, () => {
      const bytes = fileBytes(name);
      const oracle = run(() => oracleParse(bytes.slice().buffer));
      const actual = [0, 7, 50].map((chunk) => run(() => rust(bytes, chunk)));
      for (const outcome of actual) {
        const known = DISAGREEMENTS[name];
        if (known) {
          expect('code' in oracle ? oracle.code : 'mesh').toBe(known[0]);
          expect('code' in outcome ? outcome.code : 'mesh').toBe(known[1]);
        } else if ('code' in oracle) {
          expect(outcome).toEqual({ code: oracle.code });
        } else {
          expect('mesh' in outcome, `${name}: Rust failed with ${'code' in outcome ? outcome.code : ''}`).toBe(true);
          expect(bits((outcome as { mesh: TriangleMesh }).mesh)).toEqual(bits(oracle.mesh));
        }
      }
    });
  }
});
