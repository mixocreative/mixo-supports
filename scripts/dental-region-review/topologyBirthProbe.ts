import { readFileSync } from 'node:fs';
import { topologyBirths } from '../../src/core/analysis/topologyBirths';
import { checkSupports } from '../../src/core/analysis/supportCheck';
import { parseStl } from '../test-support/rustImport';

const file = process.argv[2];
if (!file) throw new Error('Usage: vite-node --script topologyBirthProbe.ts <STL>');
const bytes = readFileSync(file);
const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const before = process.memoryUsage();
const started = performance.now();
const result = topologyBirths(mesh);
const elapsedMs = Math.round(performance.now() - started);
const after = process.memoryUsage();
const memoryDeltaMb = { heap: Math.round((after.heapUsed - before.heapUsed) / 1048576),
  arrayBuffers: Math.round((after.arrayBuffers - before.arrayBuffers) / 1048576),
  rss: Math.round((after.rss - before.rss) / 1048576) };
console.log(JSON.stringify({ vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3,
  elapsedMs, memoryDeltaMb, status: result.status,
  ...(result.status === 'ok' ? { births: result.births.length, firstHeights: result.births.slice(0, 10).map((birth) => birth.height) } : { reason: result.reason }) }));
if (process.argv.includes('--compare-legacy')) {
  const legacyStarted = performance.now();
  const legacy = checkSupports(mesh, [], { overhangAngleDegrees: 45, spacing: 2 });
  console.log(JSON.stringify({ legacyElapsedMs: Math.round(performance.now() - legacyStarted),
    legacyIslandWarnings: legacy.filter((problem) => problem.kind === 'island').length,
    legacyWarningCap: 50, note: 'Legacy warnings cluster and cap minima; counts are not topology-birth counts.' }));
}
