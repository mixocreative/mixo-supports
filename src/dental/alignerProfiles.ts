import type { Lang } from '../i18n';
import { REFERENCE_ALIGNER_PROFILE, type AlignerProfileData } from '../core/analysis/dentalProfile';

/**
 * The aligner types the dental flow offers (Step 0). One entry is one card: add an aligner type
 * by adding a profile data file, the flow needs no other UI code. The detector thresholds and
 * defaults of a profile live in the same file, read by the geometry (docs/SHIP-PLAN.md, Aligner profiles).
 */
export interface AlignerProfile {
  id: string;
  /** Display name and one-line description per language. */
  name: Record<Lang, string>;
  description: Record<Lang, string>;
  /** Whether this type has a central opening: `yes` types are checked against what detection finds. */
  opening: 'yes' | 'no' | 'either';
  /** Top-view line art in a 120 by 90 box: SVG path data, stroked in the card's ink colour. */
  card: readonly string[];
  /** The reference scan this type is tuned and tested with. */
  fixture: string;
}

/**
 * One source of truth: each profile is the JSON data file the Rust core reads
 * (`crates/geometry-core/src/dental/profiles/<id>.json`), so ids, names, descriptions, card art
 * and the opening expectation here are exactly what detection is parameterised by. A new type is
 * a new JSON file listed here and in the Rust `ALL`; `alignerProfiles.test.ts` fails if the lists differ.
 */
const fromData = (data: AlignerProfileData): AlignerProfile => ({
  id: data.id, name: data.name, description: data.description, opening: data.opening as AlignerProfile['opening'],
  card: data.card, fixture: data.fixture,
});

export const ALIGNER_PROFILES: readonly AlignerProfile[] = [fromData(REFERENCE_ALIGNER_PROFILE)];

export const profileById = (id: string | undefined): AlignerProfile | undefined => ALIGNER_PROFILES.find((profile) => profile.id === id);

/** Profiles a mesh without a central opening could be: the ones that do not insist on one. */
export const profilesWithoutOpening = (): readonly AlignerProfile[] => ALIGNER_PROFILES.filter((profile) => profile.opening !== 'yes');
