import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createModelCollisionIndex } from '../../src/core/supports/modelCollisionIndex';
import { preflightSupportPath } from '../../src/core/supports/pathPreflight';
import { parseStl } from '../test-support/rustImport';

const input = process.argv[2];
if (!input) throw new Error('Usage: npx vite-node --script scripts/dental-region-review/path-preflight-bench.ts model.stl');
const bytes = readFileSync(input);
const model = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const beforeMemory = process.memoryUsage().heapUsed;
const started = performance.now();
const index = createModelCollisionIndex(model);
const buildMs = performance.now() - started;
const afterMemory = process.memoryUsage().heapUsed;
const xs = Array.from({ length: 100 }, (_, i) => -25 + i * 0.5);
const queried = performance.now();
const counts = { clear: 0, blocked: 0, inconclusive: 0 };
for (const x of xs) {
  const result = preflightSupportPath(index, [[x, -5, 0], [x, 35, 0]], 0.35);
  counts[result.status]++;
}
const queryMs = performance.now() - queried;
console.log(JSON.stringify({ faces: model.indices.length / 3, valid: index.valid,
  buildMs: Number(buildMs.toFixed(2)), query100Ms: Number(queryMs.toFixed(2)),
  heapDeltaMb: Number(((afterMemory - beforeMemory) / 1048576).toFixed(2)), counts }));
