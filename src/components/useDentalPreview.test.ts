import { describe, expect, it } from 'vitest';
import type { PrintUnit } from '../state/project';
import type { DentalTipPreview } from './useDentalPreview';
import { currentDentalPreview } from './useDentalPreview';

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
