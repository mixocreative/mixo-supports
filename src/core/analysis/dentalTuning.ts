import { defaultDentalContactFootprintSettings, type DentalContactFootprintSettings } from './dentalContactFootprint';
import { REFERENCE_ALIGNER_PROFILE } from './dentalProfile';

export interface DentalTuning {
  setbackMm: number;
  stripWidthMm: number;
  density: number;
}

/** Operator defaults and limits are aligner-profile data (`crates/geometry-core/src/dental/profiles`). */
const { defaults } = REFERENCE_ALIGNER_PROFILE;

export const defaultDentalTuning: Readonly<DentalTuning> = { setbackMm: defaults.setbackMm, stripWidthMm: defaults.stripWidthMm, density: defaults.density };

/** Bounded operator controls; these are UI limits, not validated clinical ranges. */
export function parseDentalTuning(input: DentalTuning): DentalTuning {
  const { setbackMm, stripWidthMm, density } = input;
  if (![setbackMm, stripWidthMm, density].every(Number.isFinite) ||
    setbackMm < 0 || setbackMm > defaults.setbackMaxMm || stripWidthMm < defaults.stripWidthMinMm || stripWidthMm > defaults.stripWidthMaxMm ||
    density < defaults.densityMin || density > defaults.densityMax) throw new TypeError('Invalid dental strip or spacing settings');
  return { setbackMm, stripWidthMm, density };
}

export function dentalFootprintSettings(input: DentalTuning): DentalContactFootprintSettings {
  const { setbackMm, stripWidthMm, density } = parseDentalTuning(input);
  return { setback: setbackMm, width: setbackMm + stripWidthMm,
    outerSpacing: defaultDentalContactFootprintSettings.outerSpacing / density,
    innerSpacing: defaultDentalContactFootprintSettings.innerSpacing / density,
    maxSearchDistance: defaultDentalContactFootprintSettings.maxSearchDistance };
}
