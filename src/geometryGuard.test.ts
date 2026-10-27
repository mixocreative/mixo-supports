import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no type declarations
import { runGuard } from '../scripts/geometry-guard.mjs';

/**
 * U9: the geometry guard enforces SHIP-PLAN rule 3. Every production file that imports a geometry module or
 * contains vector math is a reviewed host adapter in scripts/geometry-allowlist.json; anything else fails.
 */
describe('geometry guard (enforcing)', () => {
  it('has no unlisted, mislabelled, growing or stale entries', () => {
    const report = runGuard() as { flagged: unknown[]; allowListSize: number; failures: string[] };
    expect(report.failures).toEqual([]);
    expect(report.allowListSize).toBe(report.flagged.length);
  });
});
