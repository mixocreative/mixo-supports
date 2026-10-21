/**
 * Rewrites the golden snapshots in src/goldens/__snapshots__ from the current code.
 * Run by hand only (never in CI), and only when a change of output is intended:
 *   npx vite-node scripts/update-goldens.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GOLDEN_FIXTURES } from '../src/goldens/fixtures';
import { assertFinite, formatGolden, goldenName, goldenSnapshot } from '../src/goldens/pipeline';

if (process.env.CI) throw new Error('update-goldens rewrites the goldens; it never runs in CI');

const directory = new URL('../src/goldens/__snapshots__/', import.meta.url);
mkdirSync(directory, { recursive: true });
for (const fixture of GOLDEN_FIXTURES) {
  for (const variant of fixture.variants) {
    const name = goldenName(fixture, variant);
    const started = performance.now();
    const snapshot = goldenSnapshot(fixture, variant);
    assertFinite(snapshot);
    const file = new URL(`${name}.json`, directory);
    const text = `${formatGolden(snapshot)}\n`;
    const before = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : undefined;
    const state = before === undefined ? 'NEW' : before === text ? 'unchanged' : 'CHANGED';
    writeFileSync(file, text);
    console.log(`${name}.json ${state} (${Math.round(performance.now() - started)} ms)`);
  }
}
