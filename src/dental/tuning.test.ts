import { describe, expect, it } from 'vitest';
import { profileData } from './alignerProfiles';
import { UNSAVED_TUNING, defaultDentalTuning, parseDentalTuning } from './tuning';

const REFERENCE = 'reference-aligner';

describe('dental tuning', () => {
  it('starts from the profile defaults (the area-to-spacing mapping itself is Rust footprint_settings)', () => {
    expect(defaultDentalTuning(REFERENCE)).toEqual({ positionMm: 0.25, stripWidthMm: 0.5, density: 1 });
    const { positionMm, stripWidthMm, density } = profileData(REFERENCE).defaults;
    expect(defaultDentalTuning(REFERENCE)).toEqual({ positionMm, stripWidthMm, density });
  });

  it('rejects settings outside the profile limits', () => {
    expect(() => parseDentalTuning({ positionMm: 0.3, stripWidthMm: 0, density: 1 }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ positionMm: 0.3, stripWidthMm: 1, density: Infinity }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ positionMm: -0.5, stripWidthMm: 1, density: 1 }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ positionMm: 2.6, stripWidthMm: 1, density: 1 }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ positionMm: 0.3, stripWidthMm: 2.5, density: 1 }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ positionMm: 0.3, stripWidthMm: 1, density: 2.1 }, REFERENCE)).toThrow();
    expect(parseDentalTuning({ positionMm: -0.2, stripWidthMm: 0.4, density: 1.5 }, REFERENCE)).toEqual({ positionMm: -0.2, stripWidthMm: 0.4, density: 1.5 });
    expect(() => parseDentalTuning({ positionMm: 0.3, stripWidthMm: 1, density: 1 }, 'no-such-aligner')).toThrow('unknown aligner profile');
  });

  it('reads a tuning saved as a setback as the same area, described by its middle line', () => {
    expect(parseDentalTuning({ setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 }, REFERENCE)).toEqual({ positionMm: 0.7, stripWidthMm: 0.4, density: 1.5 });
    expect(parseDentalTuning({ setbackMm: 1, stripWidthMm: 2.4, density: 1 }, REFERENCE).positionMm).toBeCloseTo(2.2, 12);
    // A project saved without a tuning used the first defaults: setback 0.2 mm, width 1 mm.
    expect(parseDentalTuning({ setbackMm: 0.2, stripWidthMm: 1, density: 1 }, REFERENCE)).toEqual(UNSAVED_TUNING);
  });
});
