import { describe, expect, it } from 'vitest';

/* U1 + SHIP-PLAN rule 6: the TS import geometry is gone (the oracle is recorded as golden files); production never
 * parses, welds or centres on the TS side. */
const production = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./goldens/**'], { query: '?raw', import: 'default', eager: true });
const tsImport = import.meta.glob<string>(['./core/import/*.ts', '!./core/import/*.test.ts'], { query: '?raw', import: 'default', eager: true });

describe('TS import geometry is gone from production', () => {
  it('src/core/import holds only the size estimate and the STL header peek', () => {
    expect(Object.keys(tsImport).sort()).toEqual(['./core/import/estimate.ts', './core/import/stlHeader.ts']);
  });

  it('no production file uses the removed TS weld/parse helpers', () => {
    const offenders = Object.entries(production)
      .filter(([file]) => file !== './importOracleBoundary.test.ts')
      .filter(([, text]) => /ts-oracle|\bweldPositions\b|\bStlWelder\b|\bparseStl\b|\bcentreInPlace\b|\bgeometryToMesh\b|\bimportStl\b/.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
