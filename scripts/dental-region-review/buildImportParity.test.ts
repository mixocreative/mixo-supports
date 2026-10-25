import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStl } from '../../src/core/import/stl';
import { proposeDentalOrientation } from '../../src/core/analysis/dental';
import { defaultSupportSettings } from '../../src/core/supports/settings';
import { runSupportJob } from '../../src/supports/jobRunner';
import { placeImportedUnits } from '../../src/state/import';
import { inverseTransformDirection, inverseTransformPoint } from '../../src/state/transform';
import { buildDentalReview } from './build';

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
    const retained = new Set(review.supports.components.flatMap((part) => part.contactId ? [part.contactId] : []));
    expect(retained.size).toBe(100);
  }, 180000);

  it('keeps dental automatic contact IDs the same in preview and export', () => {
    const mesh = reference();
    const review = buildDentalReview(mesh);
    expect(review.kind).toBe('proposal');
    if (review.kind !== 'proposal') return;
    const orientation = proposeDentalOrientation(mesh);
    expect(orientation.kind).toBe('proposal');
    if (orientation.kind !== 'proposal') return;
    const turn = { position: [0, 0, 0] as [number, number, number], rotation: review.frame.rotation };
    const localPoints = review.placement.points.map((point) => ({ ...point,
      position: inverseTransformPoint(turn, point.position), normal: inverseTransformDirection(turn, point.normal) }));
    const preview = runSupportJob({ mesh, dental: { kind: 'two-contour', rim: orientation.rim, region: review.region, stamps: [] },
      frame: review.frame, settings: { ...defaultSupportSettings, roofSeededModes: [] },
      contacts: { points: localPoints, manual: [], deleted: [], zones: [], contactSettings: {} },
      labelText: 'A', mode: 'preview' });
    const ids = (supports: typeof preview) => [...new Set(supports.components.flatMap((part) => part.contactId ? [part.contactId] : []))].sort();
    expect(ids(preview)).toEqual(ids(review.supports));
  }, 180000);
});
