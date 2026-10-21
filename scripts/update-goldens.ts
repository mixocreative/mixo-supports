/**
 * Rewrites the golden snapshots in src/goldens/__snapshots__ from the current code.
 * Run by hand only (never in CI), and only when a change of output is intended:
 *   npx vite-node scripts/update-goldens.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { GOLDEN_FIXTURES } from '../src/goldens/fixtures';
import { GOLDEN_VARIANTS, formatGolden, goldenName, goldenSnapshot } from '../src/goldens/pipeline';

const directory = new URL('../src/goldens/__snapshots__/', import.meta.url);
mkdirSync(directory, { recursive: true });
for (const fixture of GOLDEN_FIXTURES) {
  for (const variant of GOLDEN_VARIANTS) {
    const name = goldenName(fixture, variant);
    const started = performance.now();
    writeFileSync(new URL(`${name}.json`, directory), `${formatGolden(goldenSnapshot(fixture, variant))}\n`);
    console.log(`${name}.json written (${Math.round(performance.now() - started)} ms)`);
  }
}
