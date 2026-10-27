import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../core/analysis/types';
import { corpus } from '../../scripts/fixtures/stl-corpus/generate';
import { nodeEngine } from '../../scripts/test-support/rustImport';
import { exactArray, readGolden } from '../../scripts/test-support/golden';
import { finishStl, openStlSession, pushStl } from './stlSession';

/*
 * U1 odd-STL corpus: the Rust sessions (through the production host glue) must give the TS oracle's
 * recorded exact bytes (scripts/fixtures/golden/import-stl-corpus.json, U9), or the same typed error code, for every file. Where they disagree on a malformed
 * file the more user-safe result wins and is listed in DISAGREEMENTS with the reason.
 *
 * Found and fixed in Rust: non-ASCII whitespace (NBSP, U+2003, U+3000, vertical tab, BOM) between
 * ASCII tokens was dropped as no-mesh; Rust now accepts the same characters as JS regex \s.
 * Changed on purpose (U2 task 0, owner: every STL must load): keywords are case-insensitive and
 * an all-caps SOLID text file is ASCII; see DISAGREEMENTS (the recorded oracle kept three's lowercase-only rule).
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

type Recorded = { mesh: { positions: { count: number; hash: string }; indices: { count: number; hash: string } } } | { code: string };
const RECORDED = readGolden<Record<string, Recorded>>('import-stl-corpus');
const summary = (mesh: TriangleMesh) => ({ positions: exactArray(mesh.positions, 'f32'), indices: exactArray(mesh.indices) });

/** Files where Rust and the oracle differ on purpose: name -> [oracle outcome code, rust outcome code, reason]. */
const DISAGREEMENTS: Record<string, [string, string, string]> = {
  // Owner rule "all STL must load": Rust keywords and the SOLID classifier are case-insensitive, the oracle's are not.
  'ascii-uppercase-keywords.stl': ['no-mesh', 'mesh', 'uppercase VERTEX lines now parse'],
  'ascii-uppercase-solid.stl': ['no-mesh', 'mesh', 'all-caps SOLID text file is ASCII now'],
};

describe('odd-STL corpus: committed files are what the generator makes', () => {
  it('matches generate.ts byte for byte and has no stray files', () => {
    const expected = corpus();
    expect(ON_DISK).toEqual(Object.keys(expected).sort());
    for (const [name, bytes] of Object.entries(expected)) expect(fileBytes(name), name).toEqual(bytes);
  });
});

describe('odd-STL corpus: Rust equals the recorded TS oracle', () => {
  it('records every file', () => expect(Object.keys(RECORDED).sort()).toEqual(ON_DISK));
  for (const name of Object.keys(corpus()).sort()) {
    it(name, () => {
      const bytes = fileBytes(name);
      const oracle = RECORDED[name]!;
      const actual = [0, 7, 50].map((chunk) => run(() => rust(bytes, chunk)));
      for (const outcome of actual) {
        const known = DISAGREEMENTS[name];
        if (known) {
          expect('code' in oracle ? oracle.code : 'mesh').toBe(known[0]);
          expect('code' in outcome ? outcome.code : 'mesh').toBe(known[1]);
          if ('mesh' in outcome) expect(summary(outcome.mesh)).toEqual((RECORDED['ascii-lf.stl'] as { mesh: unknown }).mesh);
        } else if ('code' in oracle) {
          expect(outcome).toEqual({ code: oracle.code });
        } else {
          expect('mesh' in outcome, `${name}: Rust failed with ${'code' in outcome ? outcome.code : ''}`).toBe(true);
          expect(summary((outcome as { mesh: TriangleMesh }).mesh)).toEqual(oracle.mesh);
        }
      }
    });
  }
});
