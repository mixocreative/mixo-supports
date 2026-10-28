import type { DentalContactFootprintSettings } from '../../src/core/analysis/dentalContactFootprint';
import type { DentalTuning } from '../../src/core/analysis/dentalTuning';
import { profileData } from '../../src/dental/alignerProfiles';
import { defaultDentalTuning } from '../../src/dental/tuning';

/** Tests name the profile they run with: the reference aligner (profile #1). */
export const REFERENCE_PROFILE = 'reference-aligner';

export const referenceTuning: Readonly<DentalTuning> = defaultDentalTuning(REFERENCE_PROFILE);

/** The footprint settings Rust derives from a tuning (`dental::footprint::footprint_settings`), for the internals tests. */
export function footprintSettings(tuning: DentalTuning = referenceTuning, profile = REFERENCE_PROFILE): DentalContactFootprintSettings {
  const { defaults } = profileData(profile);
  return { setback: tuning.setbackMm, width: tuning.setbackMm + tuning.stripWidthMm, outerSpacing: defaults.outerSpacingMm / tuning.density,
    innerSpacing: defaults.innerSpacingMm / tuning.density, maxSearchDistance: defaults.maxSearchMm,
    minTipSeparation: defaults.minTipSeparationMm };
}
