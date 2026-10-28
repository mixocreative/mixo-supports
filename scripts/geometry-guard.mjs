// Geometry guard (SHIP-PLAN rule 3, U9): ENFORCING. Production TypeScript (src/ and scripts/dental-region-review)
// is host code: UI, three.js buffer copies, camera, files, workers, serialization, thin calls into the Rust core.
// Geometry (vector math, meshes, collisions, placement, transforms) lives in crates/geometry-core.
//
// A production file is "flagged" when it imports a geometry module (core/vec3, state/transform, core/supports/,
// core/analysis/, ...) or contains obvious vector math (libm calls, dot/cross/length expressions). Every flagged file
// must be listed in scripts/geometry-allowlist.json, reviewed, with one of two labels:
//   host-adapter  imports geometry types/modules but does no vector math of its own (math hits stay below the threshold)
//   host-math     a small, justified amount of render / camera / UI math; needs `why` and `maxMath` (the ratchet:
//                 the math count may not grow; lower it when math is removed)
// The guard fails (exit 1, and src/geometryGuard.test.ts fails) on: a flagged file that is not listed; any other
// label (port / retire / frozen-reference no longer exist in production); host-adapter with vector math; host-math
// over its ratchet or without `why`; a listed file that is gone or no longer flagged (keep the list tight); a
// production file or non-listed script importing test-support or ts-oracle code (any import form, incl. bare
// side-effect imports). Math hits flag a file at 1 in src/dental and src/supports, at 3 elsewhere.
// Run: node scripts/geometry-guard.mjs [--json]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'scripts/dental-region-review'];
const SKIP_DIR = new Set(['node_modules', 'goldens', '__snapshots__']);
const isTest = (path) => /\.(test|spec)\.[tj]sx?$|\.testkit\.[tj]s$/.test(path);

// Modules whose import marks a file as geometry code.
const GEOMETRY_IMPORT = /from\s+['"][^'"]*(core\/vec3|\/vec3|core\/transform|state\/transform|core\/supports\/|core\/analysis\/|core\/handedness|editing\/screenBrush)['"]/;
// Obvious vector math: libm-style calls, hand-rolled dot/cross/length expressions, squared distances.
const MATH_PATTERNS = [
  /Math\.(sqrt|hypot|atan2|acos|asin)\(/g,
  /\b(\w+)\[0\]\s*\*\s*\w+\[0\]\s*\+\s*\1\[1\]\s*\*\s*\w+\[1\]/g, // a[0]*b[0] + a[1]*b[1]
  /\b(\w+)\s*\*\s*\1\s*\+\s*(\w+)\s*\*\s*\2\b/g, // dx*dx + dy*dy
  /\b(cross|dot|normalize|subtract)\(/g,
];
// One hit is enough in the geometry-facing host folders; elsewhere (render, camera, UI) a few hits are normal.
const STRICT_DIRS = ['src/dental/', 'src/supports/'];
const mathFlag = (path) => (STRICT_DIRS.some((dir) => path.startsWith(dir)) ? 1 : 3);
const LABELS = new Set(['host-adapter', 'host-math']);

// Test code reaches production code, never the other way: any import form (named, bare side-effect, dynamic,
// require) of test-support / ts-oracle from a non-test file fails. These dev tools exist to run tests and
// oracles (re-record goldens, probes, perf) and may use them; production tools (dental-region-review) may not.
const TEST_SUPPORT_IMPORT = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"][^'"]*(?:ts-oracle|test-support)/;
const DEV_TOOLS = new Set(['scripts/update-goldens.ts', 'scripts/probe-dental-edges.ts', 'scripts/probe-dental-orientation.ts', 'scripts/perf-baseline.mjs', 'scripts/dental-face-labels.ts']);
const NOT_PRODUCTION_SCRIPTS = new Set(['test-support', 'fixtures', 'perf']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(tsx?|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !isTest(path)) out.push(path);
  }
  return out;
}

export function runGuard() {
  const allow = JSON.parse(readFileSync(join(root, 'scripts/geometry-allowlist.json'), 'utf8'));
  const flagged = [];
  const testSupportImports = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) {
      const path = relative(root, file).split(sep).join('/');
      const text = readFileSync(file, 'utf8');
      if (TEST_SUPPORT_IMPORT.test(text)) testSupportImports.push(path);
      const imports = GEOMETRY_IMPORT.test(text);
      const mathHits = MATH_PATTERNS.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
      if (!imports && mathHits < mathFlag(path)) continue;
      flagged.push({ path, imports, mathHits, entry: allow[path] ?? null });
    }
  }
  const failures = [];
  for (const item of flagged) {
    const { path, entry, mathHits } = item;
    if (!entry) failures.push(`${path}: flagged (imports=${item.imports}, mathHits=${mathHits}) but not in scripts/geometry-allowlist.json`);
    else if (!LABELS.has(entry.label)) failures.push(`${path}: label "${entry.label}" is not allowed in production (host-adapter | host-math)`);
    else if (entry.label === 'host-adapter' && mathHits >= mathFlag(path)) failures.push(`${path}: host-adapter with vector math (${mathHits} hits): move it to Rust or relabel host-math with a reason`);
    else if (entry.label === 'host-math') {
      if (!entry.why) failures.push(`${path}: host-math needs a "why"`);
      if (typeof entry.maxMath !== 'number') failures.push(`${path}: host-math needs a numeric "maxMath"`);
      else if (mathHits > entry.maxMath) failures.push(`${path}: vector math grew to ${mathHits} hits (allowed ${entry.maxMath})`);
    }
  }
  // The other scripts: only the listed dev tools may use test-support / ts-oracle.
  for (const entry of readdirSync(join(root, 'scripts'), { withFileTypes: true })) {
    if (NOT_PRODUCTION_SCRIPTS.has(entry.name) || entry.name === 'dental-region-review') continue;
    const files = entry.isDirectory() ? walk(join(root, 'scripts', entry.name)) : /\.(tsx?|mjs)$/.test(entry.name) && !isTest(entry.name) ? [join(root, 'scripts', entry.name)] : [];
    for (const file of files) {
      const path = relative(root, file).split(sep).join('/');
      if (!DEV_TOOLS.has(path) && TEST_SUPPORT_IMPORT.test(readFileSync(file, 'utf8'))) testSupportImports.push(path);
    }
  }
  const stale = Object.keys(allow).filter((path) => !flagged.some((item) => item.path === path));
  for (const path of stale) failures.push(`${path}: listed in the allow-list but gone or no longer flagged: remove the entry`);
  for (const path of testSupportImports) failures.push(`${path}: production code imports test-support / ts-oracle`);
  const byLabel = {};
  for (const item of flagged) byLabel[item.entry?.label ?? 'UNLISTED'] = (byLabel[item.entry?.label ?? 'UNLISTED'] ?? 0) + 1;
  return { flagged, byLabel, failures, allowListSize: Object.keys(allow).length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = runGuard();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`geometry-guard: ${report.flagged.length} production files import geometry modules or contain vector math; by label ${JSON.stringify(report.byLabel)}`);
    for (const failure of report.failures) console.log(`  FAIL ${failure}`);
    console.log(report.failures.length === 0 ? 'geometry-guard: ok' : `geometry-guard: ${report.failures.length} failure(s)`);
  }
  process.exit(report.failures.length === 0 ? 0 : 1);
}
