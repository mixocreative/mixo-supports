// U0 performance baseline (SHIP-PLAN: no hard target; act only on an obvious regression).
// Run: npx vite-node scripts/perf-baseline.mjs [--save]
//      npx vite-node scripts/perf-baseline.mjs --out dentalwork/perf-current.json   (also Step 2 / Step 3 change times)
//      npx vite-node scripts/perf-baseline.mjs --check dentalwork/perf-current.json (exit 1 when a median is over 2x the file's)
// perf-baseline.json is history (--save); perf-current.json is the file --check compares to. Local only (the machine is shared).
// Times, median of 3 (run 1 is also reported because it includes JIT warm-up):
//   import   - reference aligner through the import worker's code path (WASM BinaryStlSession + prepare())
//   dental   - region proposal, dental placement filter and full runSupportJob on the aligner (as jobRunner tests do)
//   knot     - golden 'knot' fixture, default variant: placement + preview support mesh
// Brush p95: screenBrush.ts is not a pure headless function today (needs camera + raycast); measured in browser in U2.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const root = process.cwd();
const require = createRequire(resolve(root, 'package.json'));
const engine = require(resolve(root, 'crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js'));

await import('./test-support/useNodeEngine'); // registers the Rust engine the transforms and the support build run on
const { binaryStlTriangles, stlKind } = await import('../src/core/import/stlHeader');
const { prepare, centerImportedWithWasm, decimateWithWasm } = await import('../src/workers/prepareImport');
const { proposeDentalSupportRegion } = await import('../src/core/analysis/dentalRegion');
const { REFERENCE_PROFILE, referenceTuning } = await import('./test-support/referenceProfile');
const { runSupportJob } = await import('../src/supports/jobRunner');
const { filterDentalPlacement } = await import('../src/dental/placement');
const { defaultSupportSettings } = await import('../src/core/supports/settings');
const { GOLDEN_FIXTURES } = await import('../src/goldens/fixtures');
const { supportedUnit } = await import('../src/goldens/pipeline');
const { unitSupportMesh } = await import('../src/supports/unitSupports');

const ALIGNER = resolve(root, 'docs/dental-reference/reference-aligner.stl');
const CHUNK_BYTES = 16 * 1024 * 1024;
const RUNS = 3;

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (value) => Math.round(value * 10) / 10;
function time(label, fn) {
  const samples = [];
  let last;
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    last = fn();
    samples.push(performance.now() - start);
  }
  return { label, medianMs: round(median(samples)), samplesMs: samples.map(round), detail: last };
}

// The same steps importWorker.ts runs for a binary STL (readStl + prepare), minus Blob slicing.
function importAligner(bytes) {
  const head = new Uint8Array(bytes.buffer, bytes.byteOffset, 84);
  const kind = stlKind(head, bytes.byteLength);
  if (kind !== 'binary') throw new Error('aligner fixture is expected to be binary STL');
  const stream = new engine.BinaryStlSession(binaryStlTriangles(head, bytes.byteLength));
  let mesh;
  try {
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) stream.push(new Uint8Array(bytes.subarray(offset, offset + CHUNK_BYTES)));
    const result = stream.finish();
    try { mesh = { positions: result.take_positions(), indices: result.take_indices() }; } finally { result.free(); }
  } finally { stream.free(); }
  const center = (item) => centerImportedWithWasm(item, engine);
  const simplify = (m, max) => decimateWithWasm(m, engine, max);
  const prepared = prepare({ name: 'reference-aligner', mesh }, 'desktop', () => {}, center, simplify);
  return { triangles: prepared.mesh.indices.length / 3, vertices: prepared.mesh.positions.length / 3 };
}

const fileBytes = readFileSync(ALIGNER);
const sourceBytes = new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
const imported = time('import reference-aligner.stl (WASM stream + centre + pick index)', () => importAligner(sourceBytes));

// Dental Generate on the aligner: region proposal, placement filter, full support build.
const alignerMesh = (() => {
  const stream = new engine.BinaryStlSession(binaryStlTriangles(sourceBytes.subarray(0, 84), sourceBytes.byteLength));
  stream.push(sourceBytes);
  const result = stream.finish();
  try { return { positions: result.take_positions(), indices: result.take_indices() }; } finally { result.free(); stream.free(); }
})();
const still = { position: [0, 0, 0], rotation: [0, 0, 0] };
const placementSettings = { overhangAngleDegrees: 45, spacing: 4, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false };
const empty = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
let lowest = Infinity;
for (let at = 1; at < alignerMesh.positions.length; at += 3) lowest = Math.min(lowest, alignerMesh.positions[at]);
const frame = { position: [0, defaultSupportSettings.liftHeight - lowest, 0], rotation: [0, 0, 0] };

const policyRim = {
  boundaryKind: 'projection-fallback', points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), openingDirection: [0, 1, 0],
  centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array([0]),
  visibilityResolution: 1, visibilityMin: [-1, -1], visibilityMax: [1, 1],
};
const dental = time('aligner dental Generate (region + filter + runSupportJob)', () => {
  const region = proposeDentalSupportRegion(alignerMesh, referenceTuning, REFERENCE_PROFILE);
  if (region.kind !== 'proposal') throw new Error(`aligner region ${region.reason}`);
  const policy = { kind: 'two-contour', profileId: REFERENCE_PROFILE, region, stamps: [], rim: policyRim };
  const placed = filterDentalPlacement({ mesh: alignerMesh, orientation: still, settings: placementSettings, dental: policy }, empty);
  const built = runSupportJob({
    mesh: alignerMesh, frame, settings: defaultSupportSettings, dental: policy,
    contacts: { points: placed.points, manual: [], deleted: [], zones: [], contactSettings: {} }, labelText: 'A', mode: 'preview',
  });
  return { contacts: placed.points.length, supportTriangles: built.indices.length / 3, dropped: built.dropped.length };
});

const knotFixture = GOLDEN_FIXTURES.find((fixture) => fixture.name === 'knot');
if (!knotFixture) throw new Error("golden fixture 'knot' not found");
const knot = time("knot Generate (golden default: placement + preview mesh)", () => {
  const unit = supportedUnit(knotFixture, 'default');
  const built = unitSupportMesh(unit, 0, 'preview');
  return { sourceTriangles: unit.source.indices.length / 3, contacts: unit.placement.points.length, supportTriangles: built.indices.length / 3 };
});

// --out / --check: the keys perf-current.json records (median of 3 each, after the warm-up the first dental run gave).
const flag = (name) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const outFile = flag('--out');
const checkFile = flag('--check');
if (outFile || checkFile) {
  const { proposeDentalSupportRegion: propose } = await import('../src/core/analysis/dentalRegion');
  const { base, jobAt } = await import('./test-support/referenceStep3');
  const ms = (fn) => { fn(); return median(Array.from({ length: RUNS }, () => { const start = performance.now(); fn(); return performance.now() - start; })); };
  // Step 2 slider: one Area width step re-proposes the region and re-filters the placement (no support build).
  const step2 = (k) => {
    const tuning = { ...referenceTuning, stripWidthMm: referenceTuning.stripWidthMm + (k % 2 ? 0.1 : 0.2) };
    const region = propose(alignerMesh, tuning, REFERENCE_PROFILE);
    if (region.kind !== 'proposal') throw new Error(`aligner region ${region.reason}`);
    return filterDentalPlacement({ mesh: alignerMesh, orientation: still, settings: placementSettings, dental: { kind: 'two-contour', profileId: REFERENCE_PROFILE, region, stamps: [], tuning, rim: policyRim } }, empty);
  };
  let k = 0;
  // Step 3 changes: the job the worker builds after one control moves (as scripts/perf/live-engine.ts), cold session.
  const step3 = {
    PillarDiameter: (n) => jobAt({ ...base, pillarDiameter: base.pillarDiameter + (n % 2 ? 0.1 : 0.2), trussDiameter: base.pillarDiameter + (n % 2 ? 0.1 : 0.2) }),
    TipSize: (n) => jobAt({ ...base, pointDiameter: base.pointDiameter + (n % 2 ? 0.05 : 0.1), touchDiameter: base.touchDiameter + (n % 2 ? 0.05 : 0.1) }),
    LiftHeight: (n) => jobAt({ ...base, liftHeight: base.liftHeight + (n % 2 ? 0.5 : 1) }),
    RaftToggle: (n) => jobAt({ ...base, raftEnabled: n % 2 === 0 ? !base.raftEnabled : base.raftEnabled }),
  };
  const current = { dentalGenerateMs: dental.medianMs, step2SliderMs: round(ms(() => step2(k++))) };
  for (const [name, change] of Object.entries(step3)) { let n = 0; current[`step3${name}Ms`] = round(ms(() => runSupportJob(change(n++), undefined, 0, undefined))); }
  if (outFile) {
    // The browser-only keys (scripts/perf/live-bench.mjs) are kept.
    const kept = (() => { try { const { tiltScanMs, tiltScanMethod } = JSON.parse(readFileSync(resolve(root, outFile), 'utf8')); return tiltScanMs === undefined ? {} : { tiltScanMs, tiltScanMethod }; } catch { return {}; } })();
    writeFileSync(resolve(root, outFile), JSON.stringify({ ...kept, date: new Date().toISOString(), machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version }, method: `median of ${RUNS} in-process runs (vite-node, Node); Step 2 = Area width step: region proposal + placement filter; Step 3 = runSupportJob after one control change, one-shot session`, ...current }, null, 2) + '\n');
    console.log(JSON.stringify(current, null, 2));
  } else {
    const saved = JSON.parse(readFileSync(resolve(root, checkFile), 'utf8'));
    const rows = Object.keys(current).map((key) => ({ key, now: current[key], saved: saved[key], over: typeof saved[key] === 'number' && current[key] > 2 * saved[key] }));
    console.table(rows);
    if (rows.some((row) => row.over)) { console.error(`regression: ${rows.filter((row) => row.over).map((row) => row.key).join(', ')} over 2x ${checkFile}`); process.exit(1); }
    console.log(`ok: every median within 2x of ${checkFile}`);
  }
  process.exit(0);
}

const report = {
  date: new Date().toISOString(),
  machine: { host: os.hostname(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, node: process.version },
  method: `median of ${RUNS} in-process runs (vite-node, Node, not a browser); sample 1 includes JIT warm-up`,
  results: { import: imported, dentalGenerate: dental, knotGenerate: knot },
  brushP95: 'measured in browser in U2 (screenBrush.ts needs camera + raycast, no pure headless function)',
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--save')) {
  mkdirSync(resolve(root, 'dentalwork'), { recursive: true });
  writeFileSync(resolve(root, 'dentalwork/perf-baseline.json'), JSON.stringify(report, null, 2) + '\n');
}
