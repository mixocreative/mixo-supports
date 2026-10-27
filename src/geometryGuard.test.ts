import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no type declarations
import { runGuard } from '../scripts/geometry-guard.mjs';

/** U0: the guard is report-only. It must run and produce a report; U9 makes findings fail. */
describe('geometry guard (report-only)', () => {
  it('executes and reports', () => {
    const report = runGuard() as { flagged: unknown[]; allowListSize: number; unlisted: { path: string }[] };
    expect(Array.isArray(report.flagged)).toBe(true);
    expect(report.allowListSize).toBeGreaterThan(0);
    if (report.unlisted.length > 0) console.warn(`geometry-guard: ${report.unlisted.length} unlisted file(s): ${report.unlisted.map((item) => item.path).join(', ')}`);
  });
});
