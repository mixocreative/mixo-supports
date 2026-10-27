import { describe, expect, it } from 'vitest';

/* U1 + SHIP-PLAN rule 6: the TS import geometry lives only in the test-only oracle; production never
 * parses, welds or centres on the TS side. */
const production = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./goldens/**'], { query: '?raw', import: 'default', eager: true });
const oracle = import.meta.glob<string>(['../scripts/test-support/ts-oracle/*.ts', '!**/*.test.ts'], { query: '?raw', import: 'default', eager: true });
const tsImport = import.meta.glob<string>(['./core/import/*.ts', '!./core/import/*.test.ts'], { query: '?raw', import: 'default', eager: true });

describe('TS import geometry is oracle-only', () => {
  it('the TS welder/parser live in the oracle, not in src/core/import', () => {
    expect(Object.keys(tsImport).sort()).toEqual(['./core/import/estimate.ts', './core/import/stlHeader.ts']);
    expect(Object.keys(oracle).map((file) => file.split('/').pop()).sort()).toEqual(['import.ts', 'stl.ts', 'weld.ts']);
  });

  it('no production file uses the oracle or the removed TS weld/parse helpers', () => {
    const offenders = Object.entries(production)
      .filter(([file]) => file !== './importOracleBoundary.test.ts')
      .filter(([, text]) => /ts-oracle|\bweldPositions\b|\bStlWelder\b|\bparseStl\b|\bcentreInPlace\b|\bgeometryToMesh\b|\bimportStl\b/.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
