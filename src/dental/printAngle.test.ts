import { describe, expect, it } from 'vitest';
import { decodeTiltScan, type TiltRow } from '../core/analysis/dentalTilt';
import type { DentalTiltScanResultLike } from '../core/analysis/dentalEngine';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { tiltFlags, tiltProblems } from '../components/DentalSteps';
import { confirmHolds } from './confirmTilt';
import { reduceSession, initialSession } from '../editing/session';

/** A scan result as the Rust call returns it: two tilts, the second failing a resin trap and a crossing. */
function fakeResult(): DentalTiltScanResultLike {
  const row = (tilt: number, step: number, flags: number, robust: number) => [tilt, step, flags, 3, 6, 18.5, 900, 37, robust, 0.1, 0.2, 0.3];
  return {
    free: () => {}, ok: () => true, reason: () => '', start_deg: () => 46.4577512332,
    rows: () => Float64Array.from([...row(45.4577512332, -1, 0, 1), ...row(46.4577512332, 0, 0b0101, 0)]),
    failing: () => ['', '', '', '', '81072', '', 'dental-opening-4', ''],
    order: () => Uint32Array.of(0, 1), pick_reason: () => 2, band: () => new Uint32Array(),
  };
}

describe('print angle (docs/ROADMAP.md F)', () => {
  it('decodes rows, flags, rotation and the pick from the Rust layout', () => {
    const scan = decodeTiltScan(fakeResult());
    if (scan.kind !== 'scan') throw new Error('expected a scan');
    expect(scan.reason).toBe('failing');
    expect(scan.band).toBeUndefined();
    expect(scan.order).toEqual([0, 1]);
    expect(scan.rows[0]).toMatchObject({ step: -1, failed: [], robust: true, rotation: [0.1, 0.2, 0.3], fittingSideTips: 3 });
    expect(scan.rows[1]!.failed).toEqual([{ rule: 'resin-trap', at: '81072' }, { rule: 'crossing', at: 'dental-opening-4' }]);
  });

  it('names each failed rule with its tilt and first failing vertex or tip in the problem entry', () => {
    const scan = decodeTiltScan(fakeResult());
    if (scan.kind !== 'scan') throw new Error('expected a scan');
    const row: TiltRow = scan.rows[1]!;
    expect(tiltFlags(row)).toEqual(['resin trap', 'support crossing the aligner']);
    expect(tiltProblems(row)).toEqual(['resin trap at 46.5° (81072)', 'support crossing the aligner at 46.5° (dental-opening-4)']);
    expect(tiltProblems(scan.rows[0]!)).toEqual([]);
  });

  it('a confirm build holds unless blocked, an island is unresolved or a rim gap needs review', () => {
    const base = { positions: new Float32Array(), indices: new Uint32Array(), parts: [], components: [], dropped: [] } as unknown as GeneratedSupportMesh;
    const rim = (needsReview: boolean) => ({ outer: { perimeterMm: 1, retained: 1, maxGapMm: 1, reviewGapMm: 2, needsReview }, opening: { perimeterMm: 1, retained: 1, maxGapMm: 1, reviewGapMm: 2, needsReview: false }, needsReview });
    expect(confirmHolds({ ...base, verdict: { status: 'clear', issues: [] }, dentalRimCoverage: rim(false) })).toBe(true);
    expect(confirmHolds({ ...base, verdict: { status: 'blocked', issues: [] } })).toBe(false);
    expect(confirmHolds({ ...base, islands: { status: 'ok', islands: [{ height: 1, vertex: 0, status: 'unresolved' }] } })).toBe(false);
    expect(confirmHolds({ ...base, dentalRimCoverage: rim(true) })).toBe(false);
    expect(confirmHolds(undefined)).toBe(false);
  });

  it('Step 2 opens with the moved-angle notice when the confirm moved the pick', () => {
    const ready = { ...initialSession, mode: 'dental' as const, dentalStage: 'aligner' as const, dentalAligner: 'ready' as const };
    const moved = reduceSession(ready, { type: 'acceptDentalOrientation', angleMovedDeg: 43.5 });
    expect(moved.dentalStage).toBe('area');
    expect(moved.dentalNotices).toEqual([{ kind: 'angle-moved', deg: 43.5 }]);
    expect(reduceSession(ready, { type: 'acceptDentalOrientation' }).dentalNotices).toEqual([]);
  });
});
