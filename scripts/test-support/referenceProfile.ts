import type { DentalContactFootprintSettings } from '../../src/core/analysis/dentalContactFootprint';
import type { DentalTuning } from '../../src/core/analysis/dentalTuning';
import { profileData } from '../../src/dental/alignerProfiles';
import { defaultDentalTuning } from '../../src/dental/tuning';

/** Tests name the profile they run with: the reference aligner (profile #1). */
export const REFERENCE_PROFILE = 'reference-aligner';

export const referenceTuning: Readonly<DentalTuning> = defaultDentalTuning(REFERENCE_PROFILE);

/** The footprint settings Rust derives from a tuning (`dental::footprint::footprint_settings`, `Tuning::band`), for the internals tests. */
export function footprintSettings(tuning: DentalTuning = referenceTuning, profile = REFERENCE_PROFILE): DentalContactFootprintSettings {
  const { defaults } = profileData(profile);
  const half = tuning.stripWidthMm / 2;
  return { low: Math.max(tuning.positionMm - half, Math.min(tuning.positionMm, 0)), high: tuning.positionMm + half,
    outerSpacing: defaults.outerSpacingMm / tuning.density,
    innerSpacing: defaults.innerSpacingMm / tuning.density, maxSearchDistance: defaults.maxSearchMm,
    minTipSeparation: defaults.minTipSeparationMm };
}
