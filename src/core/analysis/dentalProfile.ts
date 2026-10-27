import reference from '../../../crates/geometry-core/src/dental/profiles/reference-aligner.json';

/**
 * The aligner profile data file, shared with the Rust core (`crates/geometry-core/src/dental/profiles`):
 * one JSON per profile, read by Rust for detector thresholds and by the host for names, card art
 * and the default strip, density and setback. `src/dental/alignerProfiles.ts` lists the profiles.
 */
export type AlignerProfileData = typeof reference;

export const REFERENCE_ALIGNER_PROFILE: AlignerProfileData = reference;

/** Profile id the dental calls use when a caller names none. */
export const DEFAULT_PROFILE_ID = reference.id;
