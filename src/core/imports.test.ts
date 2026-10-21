import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    glob<T>(patterns: string[], options: { query: string; import: string; eager: true }): Record<string, T>;
  }
}

// The support core and the editing rules must stay portable to a Babylon.js host (mixomesh):
// no UI framework, no three.js, no DOM, no Vite-only syntax, no app state or app glue.
const GLOBBED = import.meta.glob<string>(['./**/*.ts', './**/*.tsx', '../editing/**/*.ts', '../editing/**/*.tsx'], { query: '?raw', import: 'default', eager: true });
/** Source text of every scanned module (tests included), keyed by its path under src. */
const SOURCES = Object.fromEntries(Object.entries(GLOBBED)
  .map(([key, source]) => [key.replace(/^\.\//, 'core/').replace(/^\.\.\//, ''), source] as const)
  .filter(([file]) => file !== 'core/imports.test.ts'));
const FORBIDDEN_PACKAGES = [/^react(-dom)?(\/|$)/, /^three(\/|$)/, /^@react-three\//, /^three-mesh-bvh(\/|$)/];
const FORBIDDEN_DIRS = ['components', 'state', 'workers'];
const FORBIDDEN_FILES = ['i18n'];

/** Every problem in one module's source; `file` is its path relative to src, with '/'. */
function portabilityProblems(file: string, source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const problems: string[] = [];
  const specifiers = [
    ...code.matchAll(/\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g),
    ...code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
    ...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ...code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]!);
  for (const specifier of specifiers) {
    if (specifier.includes('?')) problems.push(`${file}: bundler query import '${specifier}'`);
    if (FORBIDDEN_PACKAGES.some((pattern) => pattern.test(specifier))) problems.push(`${file}: imports '${specifier}'`);
    if (!specifier.startsWith('.')) continue;
    const [top, ...rest] = resolveFrom(file, specifier);
    const name = rest.length === 0 ? top!.replace(/\.(ts|tsx)$/, '') : undefined;
    if (FORBIDDEN_DIRS.includes(top!) || (name !== undefined && FORBIDDEN_FILES.includes(name))) {
      problems.push(`${file}: imports app module '${specifier}'`);
    }
  }
  if (/\bimport\.meta\b/.test(code) && !file.endsWith('.test.ts')) problems.push(`${file}: uses import.meta`);
  if (/\bnew\s+URL\s*\([^)]*import\.meta\.url/.test(code)) problems.push(`${file}: new URL(..., import.meta.url)`);
  if (/\b(window|document)\s*[.[]/.test(code)) problems.push(`${file}: uses a DOM global`);
  return problems;
}

/** Path segments under src that `specifier` (relative) points to from `file`. */
function resolveFrom(file: string, specifier: string): string[] {
  const parts = file.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts;
}

describe('portable modules', () => {
  const files = Object.keys(SOURCES);

  it('scans the support core and the editing rules', () => {
    expect(files).toContain('core/vec3.ts');
    expect(files).toContain('core/supports/mesh.ts');
    expect(files).toContain('editing/keys.ts');
  });

  it('import no UI framework, three.js, DOM, bundler-only syntax or app module', () => {
    expect(files.flatMap((file) => portabilityProblems(file, SOURCES[file]!))).toEqual([]);
  });
});

describe('portabilityProblems', () => {
  const check = (source: string, file = 'core/x.ts') => portabilityProblems(file, source);

  it('flags forbidden packages, static and dynamic', () => {
    expect(check(`import { useState } from 'react';`)).toHaveLength(1);
    expect(check(`import { createRoot } from 'react-dom/client';`)).toHaveLength(1);
    expect(check(`import { Vector3 } from 'three';`)).toHaveLength(1);
    expect(check(`import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';`)).toHaveLength(1);
    expect(check(`import type { ThreeEvent } from '@react-three/fiber';`)).toHaveLength(1);
    expect(check(`export { MeshBVH } from 'three-mesh-bvh';`)).toHaveLength(1);
    expect(check(`const three = await import('three');`)).toHaveLength(1);
  });

  it('flags app modules by where they resolve, from any depth', () => {
    expect(check(`import type { PrintUnit } from '../state/project';`)).toHaveLength(1);
    expect(check(`import type { PrintUnit } from '../../state/project';`, 'core/supports/x.ts')).toHaveLength(1);
    expect(check(`import { t } from '../i18n';`)).toHaveLength(1);
    expect(check(`import { MeshClient } from '../workers/meshClient';`, 'editing/x.ts')).toHaveLength(1);
    expect(check(`import { ProgressBar } from '../components/ProgressBar';`)).toHaveLength(1);
  });

  it('flags Vite worker syntax, import.meta and DOM globals', () => {
    expect(check(`import Worker from './mesh?worker';`)).toHaveLength(1);
    expect(check(`const w = new Worker(new URL('./w.ts', import.meta.url));`)).toHaveLength(2);
    expect(check(`window.addEventListener('keydown', f);`)).toHaveLength(1);
    expect(check(`const el = document.createElement('a');`)).toHaveLength(1);
  });

  it('passes core imports, data files and words in comments', () => {
    expect(check(`import { add } from '../vec3';\nimport type { TriangleMesh } from './types';`, 'core/supports/x.ts')).toEqual([]);
    expect(check(`import reference from '../../../tools/blender-parity/reference.json';`, 'core/supports/x.test.ts')).toEqual([]);
    expect(check(`// The document itself (no element focused) has no attributes.\n/* window.x */ const a = 1;`)).toEqual([]);
  });
});
