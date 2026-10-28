import { describe, expect, it } from 'vitest';
import type { PrintUnit } from '../state/project';
import type { DentalTipPreview } from './useDentalPreview';
import { currentDentalPreview, loadingFrom, shownDentalPreview, type DentalPreviewState } from './useDentalPreview';

describe('currentDentalPreview', () => {
  it('accepts only tips computed from this exact unit version and paint state', () => {
    const before = { id: 'unit-a' } as PrintUnit;
    const afterPaint = { ...before } as PrintUnit;
    const preview = { unit: before, result: { points: [{ id: 'p' }] } } as DentalTipPreview;
    expect(currentDentalPreview(before, preview)).toBe(preview);
    expect(currentDentalPreview(afterPaint, preview)).toBeUndefined();
    expect(currentDentalPreview(undefined, preview)).toBeUndefined();
  });
});

describe('the tip preview while a new one loads', () => {
  const first = { id: 'unit-a' } as PrintUnit;
  const edited = { ...first } as PrintUnit;
  const preview = { unit: first, unitId: 'unit-a', localPoints: [{ id: 'p' }] } as unknown as DentalTipPreview;
  const ready: DentalPreviewState = { kind: 'ready', unit: first, preview };

  it('keeps the previous tips shown and pickable until the new preview lands', () => {
    const loading = loadingFrom(ready, edited);
    expect(loading).toMatchObject({ kind: 'loading', last: preview });
    expect(shownDentalPreview(loading, edited)).toBe(preview);
    // Another reload before the answer keeps the same tips.
    expect(shownDentalPreview(loadingFrom(loading, { ...edited }), edited)).toBe(preview);
  });

  it('shows the ready preview once it lands, and nothing for another aligner, an error or idle', () => {
    expect(shownDentalPreview({ kind: 'ready', unit: edited, preview: { ...preview, unit: edited } }, edited)?.unit).toBe(edited);
    expect(shownDentalPreview(loadingFrom(ready, { id: 'unit-b' } as PrintUnit), { id: 'unit-b' } as PrintUnit)).toBeUndefined();
    expect(shownDentalPreview({ kind: 'error', unit: edited }, edited)).toBeUndefined();
    expect(shownDentalPreview({ kind: 'idle' }, edited)).toBeUndefined();
    expect(loadingFrom({ kind: 'error', unit: first }, edited)).toEqual({ kind: 'loading', unit: edited });
  });
});
