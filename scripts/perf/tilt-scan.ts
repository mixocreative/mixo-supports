// Print-angle search time (docs/ROADMAP.md F) on the reference aligner in Node (pkg-node build),
// with the profile's Step 3 settings (neck 2 mm, pillar 1.4 mm, lift 3.5 mm), braced and unbraced.
// Run: npx vite-node --script scripts/perf/tilt-scan.ts. The browser time is `tiltScanMs` in
// dentalwork/perf-current.json (scripts/perf/live-bench.mjs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseStl, useNodeEngine } from '../node-engine';
import { scanDentalTilts, tiltLabel } from '../../src/core/analysis/dentalTilt';

useNodeEngine();
const bytes = readFileSync(resolve(process.cwd(), 'docs/dental-reference/reference-aligner.stl'));
const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
for (const braced of [false, true, false]) {
  const t0 = performance.now();
  const scan = scanDentalTilts(mesh, 'reference-aligner', { neckLengthMm: 2, pillarDiameterMm: 1.4, liftMm: 3.5, braced });
  const ms = Math.round(performance.now() - t0);
  if (scan.kind !== 'scan') throw new Error(scan.reason);
  const band = scan.band ? `${tiltLabel(scan.rows[scan.band[0]]!.tiltDeg)}-${tiltLabel(scan.rows[scan.band[1]]!.tiltDeg)}` : 'none';
  console.log(JSON.stringify({ braced, ms, pick: tiltLabel(scan.rows[scan.order[0]!]!.tiltDeg), reason: scan.reason, band }));
}
