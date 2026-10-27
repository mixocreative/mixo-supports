import { describe, expect, it } from 'vitest';

// The support core and the editing rules must stay portable to a Babylon.js host (mixomesh):
// no UI framework, no three.js, no DOM, no Vite-only syntax, no app state or app glue.
const GLOBBED = import.meta.glob<string>(['./**/*.ts', './**/*.tsx', '../editing/**/*.ts', '../editing/**/*.tsx'], { query: '?raw', import: 'default', eager: true });
/** Source text of every scanned module (tests included), keyed by its path under src. */
const SOURCES = Object.fromEntries(Object.entries(GLOBBED)
  .map(([key, source]) => [key.replace(/^\.\//, 'core/').replace(/^\.\.\//, ''), source] as const)
  .filter(([file]) => file !== 'core/imports.test.ts'));
const FORBIDDEN_PACKAGES = [/^react(-dom)?(\/|$)/, /^three(\/|$)/, /^@react-three\//, /^three-mesh-bvh(\/|$)/];

/**
 * Where a relative import may resolve (paths from the repository root): the portable trees
 * themselves, and Blender parity data under tools/. Tests may also read the golden fixtures
 * (src/goldens), which pull three's STL loader in transitively; see core/README.md.
 */
function allowedTarget(file: string, target: readonly string[]): boolean {
  const path = target.join('/');
  if (path.startsWith('src/core/') || path.startsWith('src/editing/')) return true;
  if (path.startsWith('tools/') && path.endsWith('.json')) return true;
  // Aligner profile data is shared with the Rust core (crates/geometry-core/src/dental/profiles); tests read the face labels.
  if (path.startsWith('crates/geometry-core/src/dental/profiles/') && path.endsWith('.json')) return true;
  if (file.endsWith('.test.ts') && path.startsWith('docs/dental-reference/') && path.endsWith('.json')) return true;
  // Tests may also load fixtures through the Rust import path (scripts/test-support/rustImport).
  return file.endsWith('.test.ts') && (path.startsWith('src/goldens/') || path.startsWith('scripts/test-support/'));
}

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
    const target = resolveFrom(file, specifier);
    if (!target || !allowedTarget(file, target)) problems.push(`${file}: imports non-portable module '${specifier}'`);
  }
  if (/\bimport\.meta\b/.test(code) && !file.endsWith('.test.ts')) problems.push(`${file}: uses import.meta`);
  if (/\bnew\s+URL\s*\([^)]*import\.meta\.url/.test(code)) problems.push(`${file}: new URL(..., import.meta.url)`);
  if (/\b(window|document)\s*[.[]/.test(code)) problems.push(`${file}: uses a DOM global`);
  return problems;
}

/**
 * Path segments from the repository root that `specifier` (relative) points to from `file`
 * (a path under src); undefined when it climbs above the repository root.
 */
function resolveFrom(file: string, specifier: string): string[] | undefined {
  const parts = ['src', ...file.split('/').slice(0, -1)];
  for (const part of specifier.split('/')) {
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else if (part !== '.') parts.push(part);
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

  it('flags anything outside core, editing and tools data, from any depth', () => {
    expect(check(`import { unitContacts } from '../supports/unitSupports';`)).toHaveLength(1);
    expect(check(`import { deleteCommands } from '../../supports/selection';`, 'core/supports/x.ts')).toHaveLength(1);
    expect(check(`import { GOLDEN_FIXTURES } from '../goldens/fixtures';`)).toHaveLength(1);
    expect(check(`import { x } from '../../../src/state/x';`)).toHaveLength(1);
    expect(check(`import { x } from '../../../../outside';`)).toHaveLength(1);
    expect(check(`import code from '../../../tools/blender-parity/probe.py';`, 'core/supports/x.test.ts')).toHaveLength(1);
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
    expect(check(`import { useCase } from '../../editing/keys';`, 'core/supports/x.ts')).toEqual([]);
    expect(check(`import { GOLDEN_FIXTURES } from '../../goldens/fixtures';`, 'core/analysis/x.test.ts')).toEqual([]);
    expect(check(`// The document itself (no element focused) has no attributes.\n/* window.x */ const a = 1;`)).toEqual([]);
  });
});
