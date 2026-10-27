import type { ExportUnitResult } from '../workers/meshProtocol';

/*
 * The export gate (U8): files are written only from a result that is the newest, finished and
 * judged. Anything else is refused with a message, never written quietly:
 *  - stale: the unit changed while the export ran, or its result answers another revision;
 *  - failed: the build returned nothing for a unit that has supports in the files;
 *  - inconclusive: the body-clearance verdict could not be reached (a timeout or a crossing that
 *    cannot be judged), which is never treated as clear.
 * Not refusals: a `blocked` verdict lists where supports touch the model (every generic build is
 * blocked), and an inconclusive island verdict means the model's own mesh could not be analysed
 * (a degenerate triangle, as in `scripts/fixtures/knot.stl`, makes the topology refuse). Both are
 * reported in the problem list (U10), not by stopping the export.
 */
export interface ExportRefusal {
  reason: 'stale' | 'failed' | 'inconclusive';
  unitId: string;
}

export function exportRefusal(
  requested: { revision: number; units: readonly ExportUnitResult[] },
  /** Units whose supports are in the files. */
  needed: readonly string[],
  /** Whether the unit is still exactly the one the export started from. */
  unchanged: (unitId: string) => boolean,
): ExportRefusal | undefined {
  for (const unitId of needed) {
    if (!unchanged(unitId)) return { reason: 'stale', unitId };
    const result = requested.units.find((unit) => unit.unitId === unitId);
    if (!result) return { reason: 'failed', unitId };
    if (result.revision !== requested.revision) return { reason: 'stale', unitId };
    if (result.verdict === 'inconclusive') return { reason: 'inconclusive', unitId };
  }
  return undefined;
}
