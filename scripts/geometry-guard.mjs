// U0 geometry guard (SHIP-PLAN rule 3 / U9). REPORT-ONLY: always exits 0 for now.
// Lists production TS files that import geometry modules or contain obvious vector math, and compares them
// with scripts/geometry-allowlist.json (derived from dentalwork/wasm-geometry-inventory.md labels).
// U9 turns "unlisted" and "host-adapter with heavy math" into failures. Run: node scripts/geometry-guard.mjs [--json]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'scripts/dental-region-review'];
const SKIP_DIR = new Set(['node_modules', 'goldens', '__snapshots__', 'test-support', 'ts-oracle']);
const isTest = (path) => /\.(test|spec)\.[tj]sx?$|\.testkit\.[tj]s$/.test(path);

// Modules whose import marks a file as geometry code.
const GEOMETRY_IMPORT = /from\s+['"][^'"]*(core\/vec3|\/vec3|core\/transform|state\/transform|core\/supports\/|core\/analysis\/|core\/handedness|editing\/screenBrush|three-mesh-bvh)['"]/;
// Obvious vector math: libm-style calls or hand-rolled dot/cross/length expressions.
const MATH_PATTERNS = [
  /Math\.(sqrt|hypot|atan2|acos|asin)\(/g,
  /\b(\w+)\[0\]\s*\*\s*\w+\[0\]\s*\+\s*\1\[1\]\s*\*\s*\w+\[1\]/g, // a[0]*b[0] + a[1]*b[1]
  /\b(cross|dot|normalize|subtract)\(/g,
];
const MATH_HITS_FLAG = 3;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !isTest(path)) out.push(path);
  }
  return out;
}

export function runGuard() {
  const allow = JSON.parse(readFileSync(join(root, 'scripts/geometry-allowlist.json'), 'utf8'));
  const flagged = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) {
      const path = relative(root, file).split(sep).join('/');
      const text = readFileSync(file, 'utf8');
      const imports = GEOMETRY_IMPORT.test(text);
      const mathHits = MATH_PATTERNS.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
      if (!imports && mathHits < MATH_HITS_FLAG) continue;
      flagged.push({ path, imports, mathHits, label: allow[path] ?? null });
    }
  }
  const byLabel = {};
  for (const item of flagged) byLabel[item.label ?? 'UNLISTED'] = (byLabel[item.label ?? 'UNLISTED'] ?? 0) + 1;
  const unlisted = flagged.filter((item) => item.label === null);
  const stale = Object.keys(allow).filter((path) => !flagged.some((item) => item.path === path));
  // Heavy math in a file labelled host-adapter is the defect class U9 will enforce.
  const hostMath = flagged.filter((item) => item.label === 'host-adapter' && item.mathHits >= MATH_HITS_FLAG);
  return { flagged, byLabel, unlisted, hostMath, staleAllowEntries: stale, allowListSize: Object.keys(allow).length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = runGuard();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`geometry-guard (report-only): ${report.flagged.length} production files import geometry modules or contain vector math`);
    console.log(`  by label: ${JSON.stringify(report.byLabel)}`);
    console.log(`  unlisted (not in inventory): ${report.unlisted.length}`);
    for (const item of report.unlisted) console.log(`    ${item.path} (imports=${item.imports}, mathHits=${item.mathHits})`);
    console.log(`  host-adapter files with vector math (U9 must clear): ${report.hostMath.length}`);
    for (const item of report.hostMath) console.log(`    ${item.path} (mathHits=${item.mathHits})`);
    console.log(`  allow-list entries not flagged by the scan: ${report.staleAllowEntries.length}`);
  }
  process.exit(0);
}
