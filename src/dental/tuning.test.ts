import { describe, expect, it } from 'vitest';
import { profileData } from './alignerProfiles';
import { defaultDentalTuning, parseDentalTuning } from './tuning';

const REFERENCE = 'reference-aligner';

describe('dental tuning', () => {
  it('starts from the profile defaults (the strip-to-spacing mapping itself is Rust footprint_settings)', () => {
    expect(defaultDentalTuning(REFERENCE)).toEqual({ setbackMm: 0.2, stripWidthMm: 1, density: 1 });
    const { setbackMm, stripWidthMm, density } = profileData(REFERENCE).defaults;
    expect(defaultDentalTuning(REFERENCE)).toEqual({ setbackMm, stripWidthMm, density });
  });

  it('rejects settings outside the profile limits', () => {
    expect(() => parseDentalTuning({ setbackMm: 0, stripWidthMm: 0, density: 1 }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ setbackMm: 0.2, stripWidthMm: 1, density: Infinity }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ setbackMm: -0.1, stripWidthMm: 1, density: 1 }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ setbackMm: 0.2, stripWidthMm: 2.5, density: 1 }, REFERENCE)).toThrow();
    expect(() => parseDentalTuning({ setbackMm: 0.2, stripWidthMm: 1, density: 2.1 }, REFERENCE)).toThrow();
    expect(parseDentalTuning({ setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 }, REFERENCE)).toEqual({ setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 });
    expect(() => parseDentalTuning({ setbackMm: 0.2, stripWidthMm: 1, density: 1 }, 'no-such-aligner')).toThrow('unknown aligner profile');
  });
});
