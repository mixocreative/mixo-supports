import '../test-support/useNodeEngine';
/*
 * ONE-OFF recorder (U9): ran the TS import oracle (scripts/test-support/ts-oracle/stl.ts, weld.ts) once and
 * wrote its outputs to scripts/fixtures/golden/import-*.json. Deleted together with the oracle; regenerate
 * from Rust with `UPDATE_GOLDENS=1 npx vitest run <the parity test>` (see scripts/test-support/golden.ts).
 *   npx vite-node scripts/golden/record-import.ts
 */
import { readFileSync } from 'node:fs';
import type { TriangleMesh } from '../../src/core/analysis/types';
import { corpus } from '../fixtures/stl-corpus/generate';
import { exactArray, writeGolden } from '../test-support/golden';
import { StlWelder, parseStl } from '../test-support/ts-oracle/stl';
import { weldPositions } from '../test-support/ts-oracle/weld';

const meshGolden = (mesh: TriangleMesh) => ({ positions: exactArray(mesh.positions, 'f32'), indices: exactArray(mesh.indices) });
const fileBytes = (path: string) => { const f = readFileSync(path); return new Uint8Array(f.buffer, f.byteOffset, f.byteLength); };

// stl-corpus
const out: Record<string, unknown> = {};
for (const name of Object.keys(corpus()).sort()) {
  try {
    out[name] = { mesh: meshGolden(parseStl(fileBytes(`scripts/fixtures/stl-corpus/${name}`).slice().buffer)) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!code) throw error;
    out[name] = { code };
  }
}
writeGolden('import-stl-corpus', out);

// streaming sessions
const aligner = fileBytes('docs/dental-reference/reference-aligner.stl');
const welder = new StlWelder(aligner.subarray(0, 84), aligner.length);
for (let o = 0; o < aligner.length; o += 1_000_003) welder.push(aligner.subarray(o, o + 1_000_003));
const ascii = (text: string, chunk: number) => {
  const bytes = new TextEncoder().encode(text);
  const w = new StlWelder(bytes.subarray(0, 84), bytes.length);
  for (let o = 0; o < bytes.length; o += chunk) w.push(bytes.subarray(o, o + chunk));
  const m = w.finish();
  return { positions: Array.from(m.positions), indices: Array.from(m.indices) };
};
const split = 'solid x\nvertex 0\n 0 0\nvertex 1 0 0\nvertex 0 0 1\n';
const aligned = ['solid aligner', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 1.25 0 0', 'vertex 0 0 1e0', 'endloop', 'endfacet', 'facet normal 0 0 1', 'outer loop', 'vertex 1.25 0 0', 'vertex 0 0 1e0', 'vertex -0.125 2.5 0', 'endloop', 'endfacet', 'endsolid aligner'].join('\n');
writeGolden('import-stl-aligner', meshGolden(welder.finish()));
writeGolden('import-stl-ascii-multiline', ascii(split, 1 << 20));
writeGolden('import-stl-ascii-split', ascii(aligned, 7));

// weld
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const weld = (raw: Float32Array, indices: Uint32Array, matrix = identity) => {
  const input = raw.slice();
  const m = weldPositions(input, indices.length > 0 ? indices : undefined, matrix);
  return { ...meshGolden(m), input: exactArray(input, 'f32') };
};
const a = new Float32Array([0, 0, 0, -0, 0, 0, 1, 2, 3, 1.00001, 2, 3, 214_748.4, 1, 1, 214_749, 1, 1, -300_000, 5, 5]);
const b = new Float32Array(3000); for (let i = 0; i < b.length; i += 1) b[i] = Math.fround((i % 71) * 0.137 - 4);
const bi = new Uint32Array(b.length); for (let i = 0; i < bi.length; i += 1) bi[i] = (i * 37) % (b.length / 3);
const c = new Float32Array(900); for (let i = 0; i < c.length; i += 1) c[i] = Math.fround(Math.round((i % 33) * 0.13) / 10 + (i % 5) * 0.00003);
writeGolden('import-weld-first-seen', weld(a, new Uint32Array([6, 4, 3, 0, 1, 2, 5, 6, 0])));
writeGolden('import-weld-transformed', weld(b, bi, [1.2, 0.1, 0, 0, -0.2, 0.9, 0.3, 0, 0.05, -0.1, 1.1, 0, 3.25, -2.5, 11.125, 1]));
writeGolden('import-weld-unindexed', weld(c, new Uint32Array()));
