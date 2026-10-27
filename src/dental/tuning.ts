import type { DentalTuning } from '../core/analysis/dentalTuning';
import { profileData } from './alignerProfiles';

/** The strip controls an aligner type starts with (its profile file). */
export function defaultDentalTuning(profileId: string): DentalTuning {
  const { setbackMm, stripWidthMm, density } = profileData(profileId).defaults;
  return { setbackMm, stripWidthMm, density };
}

/** Bounded operator controls (the profile's limits; UI limits, not validated clinical ranges). */
export function parseDentalTuning(input: DentalTuning, profileId: string): DentalTuning {
  const { defaults } = profileData(profileId);
  const { setbackMm, stripWidthMm, density } = input;
  if (![setbackMm, stripWidthMm, density].every(Number.isFinite) ||
    setbackMm < 0 || setbackMm > defaults.setbackMaxMm || stripWidthMm < defaults.stripWidthMinMm || stripWidthMm > defaults.stripWidthMaxMm ||
    density < defaults.densityMin || density > defaults.densityMax) throw new TypeError('Invalid dental strip or spacing settings');
  return { setbackMm, stripWidthMm, density };
}
