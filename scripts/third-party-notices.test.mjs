import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collect, isCopyleft, render } from './third-party-notices.mjs';

const dirs = [];
function fixture(root, pkgs) {
  const dir = mkdtempSync(join(tmpdir(), 'notices-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify(root));
  for (const [path, pkg, files = {}] of pkgs) {
    const p = join(dir, 'node_modules', ...path.split('/'));
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'package.json'), JSON.stringify(pkg));
    for (const [f, t] of Object.entries(files)) writeFileSync(join(p, f), t);
  }
  return dir;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('third-party notices collector', () => {
  it('walks transitive deps, ignores dev deps, sorts deterministically', () => {
    const dir = fixture({ dependencies: { zed: '1', alpha: '1' }, devDependencies: { dev: '1' } }, [
      ['zed', { name: 'zed', version: '1.0.0', license: 'MIT', dependencies: { deep: '1' } }, { LICENSE: 'zed text' }],
      ['alpha', { name: 'alpha', version: '2.0.0', license: 'ISC' }, { 'LICENSE.md': 'alpha text' }],
      ['deep', { name: 'deep', version: '0.1.0', licenses: [{ type: 'Apache-2.0' }] }, { NOTICE: 'deep notice' }],
      ['dev', { name: 'dev', version: '1.0.0', license: 'GPL-3.0' }],
    ]);
    const { packages, problems } = collect(dir);
    expect(problems).toEqual([]);
    expect(packages.map((p) => `${p.name}@${p.version}:${p.license}`)).toEqual([
      'alpha@2.0.0:ISC',
      'deep@0.1.0:Apache-2.0',
      'zed@1.0.0:MIT',
    ]);
    const text = render(packages);
    expect(text).toContain('alpha text');
    expect(text).toContain('deep notice');
  });

  it('reports copyleft and missing licence text', () => {
    const dir = fixture({ dependencies: { a: '1', b: '1', c: '1' } }, [
      ['a', { name: 'a', version: '1.0.0', license: 'LGPL-3.0' }, { COPYING: 'x' }],
      ['b', { name: 'b', version: '1.0.0', license: 'MIT' }],
      ['c', { name: 'c', version: '1.0.0', license: '(MIT OR GPL-2.0)' }, { LICENSE: 'c' }],
    ]);
    const { problems } = collect(dir);
    expect(problems).toEqual(['a@1.0.0: copyleft licence LGPL-3.0', 'b@1.0.0: no LICENSE/LICENCE/COPYING/NOTICE text']);
  });

  it('classifies SPDX expressions', () => {
    expect(isCopyleft('GPL-3.0-only')).toBe(true);
    expect(isCopyleft('AGPL-3.0')).toBe(true);
    expect(isCopyleft('MIT OR GPL-3.0')).toBe(false);
    expect(isCopyleft('MIT AND GPL-3.0')).toBe(true);
    expect(isCopyleft('MIT')).toBe(false);
  });
});
