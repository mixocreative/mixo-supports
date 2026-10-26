import { defaultDentalContactFootprintSettings, type DentalContactFootprintSettings } from './dentalContactFootprint';

export interface DentalTuning {
  setbackMm: number;
  stripWidthMm: number;
  density: number;
}

export const defaultDentalTuning: Readonly<DentalTuning> = { setbackMm: 0.2, stripWidthMm: 1, density: 1 };

/** Bounded operator controls; these are UI limits, not validated clinical ranges. */
export function parseDentalTuning(input: DentalTuning): DentalTuning {
  const { setbackMm, stripWidthMm, density } = input;
  if (![setbackMm, stripWidthMm, density].every(Number.isFinite) ||
    setbackMm < 0 || setbackMm > 1 || stripWidthMm < 0.2 || stripWidthMm > 2.4 ||
    density < 0.5 || density > 2) throw new TypeError('Invalid dental strip or spacing settings');
  return { setbackMm, stripWidthMm, density };
}

export function dentalFootprintSettings(input: DentalTuning): DentalContactFootprintSettings {
  const { setbackMm, stripWidthMm, density } = parseDentalTuning(input);
  return { setback: setbackMm, width: setbackMm + stripWidthMm,
    outerSpacing: defaultDentalContactFootprintSettings.outerSpacing / density,
    innerSpacing: defaultDentalContactFootprintSettings.innerSpacing / density,
    maxSearchDistance: defaultDentalContactFootprintSettings.maxSearchDistance };
}
