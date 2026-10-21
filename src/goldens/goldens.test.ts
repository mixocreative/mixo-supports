import { describe, expect, it } from 'vitest';
import { GOLDEN_FIXTURES } from './fixtures';
import { assertFinite, goldenDiff, goldenName, goldenSnapshot } from './pipeline';

/** Stored snapshots, written only by `npx vite-node scripts/update-goldens.ts`. */
const STORED = import.meta.glob<string>(['./__snapshots__/*.json'], { query: '?raw', import: 'default', eager: true });

describe('golden fixtures', () => {
  for (const fixture of GOLDEN_FIXTURES) {
    for (const variant of fixture.variants) {
      const name = goldenName(fixture, variant);
      const change = fixture.expectedChanges?.[variant];
      it(`reproduces ${name} exactly${change ? ` (expected to change in ${change})` : ''}`, () => {
        const stored = STORED[`./__snapshots__/${name}.json`];
        expect(stored, `missing snapshot ${name}.json (run npx vite-node scripts/update-goldens.ts)`).toBeDefined();
        // Round-trip through JSON so the comparison sees exactly what a snapshot can hold.
        const snapshot = goldenSnapshot(fixture, variant);
        assertFinite(snapshot);
        const actual: unknown = JSON.parse(JSON.stringify(snapshot));
        const differences = goldenDiff(JSON.parse(stored!), actual);
        expect(differences, `${name} differs from its golden:\n${differences.join('\n')}`).toEqual([]);
      });
    }
  }
});
