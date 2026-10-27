import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proposeDentalOrientation } from '../../src/core/analysis/dental';
import { sampleDiagnosticContourContacts } from '../../src/core/analysis/dentalContourContacts';
import { defaultSupportSettings } from '../../src/core/supports/settings';
import { runSupportJob } from '../../src/supports/jobRunner';
import { placeImportedUnits } from '../../src/state/import';
import { inverseTransformDirection, inverseTransformPoint, transformPoint } from '../../src/state/transform';
import { buildDentalReview } from './build';
import { unresolvedCircularArcs } from './phaseGap';
import { parseStl } from '../test-support/rustImport';
import { REFERENCE_PROFILE } from '../test-support/referenceProfile';

/** The tip ID the placement code derives from a unit-local position: 0.01 mm rounding. */
const positionId = (position: readonly number[]): string => `auto-${position.map((value) => Math.round(value * 100)).join('_')}`;

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('dental import and preview parity', () => {
  it('reviews the same centred source mesh used after browser import', () => {
    const unit = placeImportedUnits([{ name: 'reference', mesh: reference() }], [],
      { lift: defaultSupportSettings.liftHeight, createId: () => 'reference' })[0]!;
    const review = buildDentalReview(unit.source);
    expect(review.kind).toBe('proposal');
    if (review.kind !== 'proposal') return;
    expect(review.supports.droppedByPath).toBeUndefined();
    const retained = new Set(review.supports.components.flatMap((part) => part.contactId ? [part.contactId] : []));
    // 100 placed primaries survive, and one primary whose support crossed the model was moved to its
    // repair alternate (a phase-zero sample, new position ID) instead of being left out.
    const placed = new Set(review.placement.points.map((point) => point.id));
    expect(retained.size).toBe(101);
    expect([...retained].filter((id) => !placed.has(id))).toHaveLength(1);
    const shifted = sampleDiagnosticContourContacts(unit.source, review.region.openingEdges,
      review.bands.innerOtherSide, { spacing: 2, phaseMm: 0, maxSearchDistance: 1.5 });
    expect(shifted.kind).toBe('proposal');
    if (shifted.kind !== 'proposal') return;
    const turn = { position: [0, 0, 0] as [number, number, number], rotation: review.frame.rotation };
    const retainedAt = (review.region.contacts ?? []).filter((contact) => contact.rim === 'opening' &&
      retained.has(positionId(transformPoint(turn, contact.position)))).map((contact) => contact.distanceAlongContour);
    const arcs = unresolvedCircularArcs(contourLength(unit.source.positions, review.region.openingEdges), retainedAt,
      shifted.contacts.map((contact) => ({ atMm: contact.distanceAlongContour, face: contact.face })), 4);
    expect(arcs.map((arc) => [Math.round(arc.gapMm), arc.candidates.length])).toEqual([
      [10, 5], [6, 3], [10, 5], [8, 4], [8, 4],
    ]);
  }, 180000);

  it('keeps dental automatic contact IDs the same in preview and export', () => {
    const mesh = reference();
    const review = buildDentalReview(mesh);
    expect(review.kind).toBe('proposal');
    if (review.kind !== 'proposal') return;
    const orientation = proposeDentalOrientation(mesh, REFERENCE_PROFILE);
    expect(orientation.kind).toBe('proposal');
    if (orientation.kind !== 'proposal') return;
    const turn = { position: [0, 0, 0] as [number, number, number], rotation: review.frame.rotation };
    const localPoints = review.placement.points.map((point) => ({ ...point,
      position: inverseTransformPoint(turn, point.position), normal: inverseTransformDirection(turn, point.normal) }));
    const supportJob = { mesh, dental: { kind: 'two-contour' as const, profileId: REFERENCE_PROFILE, rim: orientation.rim, region: review.region, stamps: [] },
      frame: review.frame, settings: { ...defaultSupportSettings, roofSeededModes: [] },
      contacts: { points: localPoints, manual: [], deleted: [], zones: [], contactSettings: {} },
      labelText: 'A', mode: 'preview' as const };
    const preview = runSupportJob(supportJob);
    const ids = (supports: typeof preview) => [...new Set(supports.components.flatMap((part) => part.contactId ? [part.contactId] : []))].sort();
    expect(ids(preview)).toEqual(ids(review.supports));
    // Export keeps the same automatic contacts as the preview. (The opt-in path preflight that used to be
    // compared here ran inside the TS builder; it returns, if its measured benefit holds, with the U7 safety engine.)
    const exported = runSupportJob({ ...supportJob, mode: 'export' });
    expect(exported.droppedByPath).toBeUndefined();
    expect(ids(exported)).toEqual(ids(preview));
  }, 180000);
});

/** Length of a contour given as vertex pairs (test-side measure of the opening rim). */
function contourLength(positions: Float32Array, edges: Uint32Array): number {
  let sum = 0;
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k]! * 3, b = edges[k + 1]! * 3;
    sum += Math.hypot(positions[a]! - positions[b]!, positions[a + 1]! - positions[b + 1]!, positions[a + 2]! - positions[b + 2]!);
  }
  return sum;
}
