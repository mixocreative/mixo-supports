// Build-time third-party notices for the bundled npm packages.
//
//   node scripts/third-party-notices.mjs      (run by `npm run build` as postbuild)
//
// Walks the production dependency tree (package.json "dependencies", recursively through
// node_modules/<pkg>/package.json), collects name, version, licence and the licence file text, and
// writes dist/THIRD-PARTY-NOTICES.txt = public/THIRD-PARTY-NOTICES.txt + a generated npm section.
// Fails (exit 1) on a copyleft licence without a permissive alternative, or a package with no licence text.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Find node_modules/<name>/package.json the way node resolves it: from `fromDir` upwards. */
function locate(name, fromDir, rootDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return dirname(candidate);
    if (dir === rootDir || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}

export function licenceOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).filter(Boolean);
    if (types.length) return types.join(' OR ');
  }
  return '';
}

/** Copyleft unless some "OR" alternative has no (A/L)GPL term. */
export function isCopyleft(expression) {
  const alternatives = expression.replace(/[()]/g, ' ').split(/\s+OR\s+/i);
  return !alternatives.some((alt) => !/GPL/i.test(alt));
}

function licenceTexts(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENSE_FILE.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ file: name, text: readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n').trim() }))
    .filter((t) => t.text.length > 0);
}

/**
 * Reviewed exceptions, so a NEW package without licence data still fails the build.
 *  noFileOk:        packages whose tarball ships no licence file; the notice then states the licence,
 *                   author and repository declared in package.json.
 *  licenseOverride: packages with a licence file but no "license" field (value read from that file).
 */
export const REVIEWED = {
  noFileOk: new Set(['@mediapipe/tasks-vision', 'maath', 'stats-gl', 'draco3d', '@react-three/fiber']),
  licenseOverride: new Map([['webgl-constants', 'MIT']]),
};

/** @returns {{packages: Array<{name, version, license, homepage, texts}>, problems: string[]}} */
export function collect(rootDir, reviewed = { noFileOk: new Set(), licenseOverride: new Map() }) {
  const root = readJson(join(rootDir, 'package.json'));
  const seen = new Map();
  const problems = [];

  function visit(name, fromDir, optional) {
    const dir = locate(name, fromDir, rootDir);
    if (!dir) {
      if (!optional) problems.push(`${name}: not installed (run npm ci)`);
      return;
    }
    const pkg = readJson(join(dir, 'package.json'));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    const license = licenceOf(pkg) || reviewed.licenseOverride.get(pkg.name) || '';
    let texts = licenceTexts(dir);
    const declared = texts.length === 0 && reviewed.noFileOk.has(pkg.name);
    if (declared) {
      const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || '';
      const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '';
      texts = [{ file: 'package.json', text: `This package ships no licence file. Declared in its package.json: licence ${license}${author ? `, author ${author}` : ''}${repo ? `, repository ${repo}` : ''}.` }];
    }
    seen.set(key, { name: pkg.name, version: pkg.version, license, homepage: pkg.homepage || '', texts });
    if (!license) problems.push(`${key}: no licence in package.json`);
    else if (isCopyleft(license)) problems.push(`${key}: copyleft licence ${license}`);
    if (texts.length === 0) problems.push(`${key}: no LICENSE/LICENCE/COPYING/NOTICE text`);
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir, false);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, dir, true);
  }

  for (const dep of Object.keys(root.dependencies ?? {})) visit(dep, rootDir, false);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const packages = [...seen.values()].sort((a, b) => cmp(a.name, b.name) || cmp(a.version, b.version));
  return { packages, problems };
}

export function render(packages) {
  const bar = '='.repeat(78);
  const out = [
    '',
    bar,
    '',
    'npm packages bundled in the application (generated at build time)',
    '',
    'Production dependencies of this project and their dependencies, each under the',
    'licence stated in its package metadata. Full licence texts follow.',
    '',
    'Packages',
    ...packages.map((p) => `  ${p.name}@${p.version} - ${p.license}`),
  ];
  for (const p of packages) {
    out.push('', bar, '', `${p.name}@${p.version}`, `Licence: ${p.license}`);
    if (p.homepage) out.push(`Homepage: ${p.homepage}`);
    for (const t of p.texts) out.push('', `--- ${t.file} ---`, '', t.text);
  }
  return out.join('\n') + '\n';
}

function main() {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { packages, problems } = collect(rootDir, REVIEWED);
  if (problems.length) {
    console.error('third-party notices: build failed');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const handWritten = readFileSync(join(rootDir, 'public', 'THIRD-PARTY-NOTICES.txt'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '\n');
  mkdirSync(join(rootDir, 'dist'), { recursive: true });
  writeFileSync(join(rootDir, 'dist', 'THIRD-PARTY-NOTICES.txt'), handWritten + render(packages));
  console.log(`third-party notices: ${packages.length} npm packages -> dist/THIRD-PARTY-NOTICES.txt`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
