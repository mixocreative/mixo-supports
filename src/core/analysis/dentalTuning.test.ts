import { describe, expect, it } from 'vitest';
import { defaultDentalTuning, dentalFootprintSettings, parseDentalTuning } from './dentalTuning';

describe('dental tuning', () => {
  it('preserves the established strip and rim-spacing defaults', () => {
    expect(dentalFootprintSettings(defaultDentalTuning)).toEqual({
      setback: 0.2, width: 1.2, outerSpacing: 3, innerSpacing: 2, maxSearchDistance: 1.5,
    });
  });

  it('moves a nonzero strip away from the rim and scales both rim spacings together', () => {
    expect(dentalFootprintSettings({ setbackMm: 0.5, stripWidthMm: 0.4, density: 1.5 })).toEqual({
      setback: 0.5, width: 0.9, outerSpacing: 2, innerSpacing: 2 / 1.5, maxSearchDistance: 1.5,
    });
  });

  it('rejects settings outside bounded UI and worker inputs', () => {
    expect(() => parseDentalTuning({ setbackMm: 0, stripWidthMm: 0, density: 1 })).toThrow();
    expect(() => parseDentalTuning({ setbackMm: 0.2, stripWidthMm: 1, density: Infinity })).toThrow();
    expect(() => parseDentalTuning({ setbackMm: -0.1, stripWidthMm: 1, density: 1 })).toThrow();
    expect(() => parseDentalTuning({ setbackMm: 0.2, stripWidthMm: 2.5, density: 1 })).toThrow();
    expect(() => parseDentalTuning({ setbackMm: 0.2, stripWidthMm: 1, density: 2.1 })).toThrow();
  });
});
