import type { Lang } from '../i18n';

/**
 * The aligner types the dental flow offers (Step 0). One entry is one card: add an aligner type
 * by adding an entry here, the flow needs no other UI code. The detector thresholds and defaults
 * of a profile live with the geometry (docs/SHIP-PLAN.md, Aligner profiles).
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

export const ALIGNER_PROFILES: readonly AlignerProfile[] = [
  {
    id: 'reference-aligner',
    name: { en: 'Reference aligner', 'zh-Hant': '標準牙套', ja: '標準アライナー' },
    description: {
      en: 'U-shaped aligner with a central opening, supported along its lower rim.',
      'zh-Hant': '中央有開口的 U 形牙套，支撐加在下緣。',
      ja: '中央に開口のあるU字型アライナー。下縁にサポートを付けます。',
    },
    opening: 'yes',
    card: [
      // Outer U outline, open at the top.
      'M18 14 C18 14 14 50 24 68 C34 82 86 82 96 68 C106 50 102 14 102 14',
      'M18 14 L34 14 M86 14 L102 14',
      // Inner edge of the arch.
      'M34 14 C34 14 32 46 40 58 C47 67 73 67 80 58 C88 46 86 14 86 14',
      // Central opening.
      'M50 36 C50 31 70 31 70 36 C70 44 66 50 60 50 C54 50 50 44 50 36 Z',
    ],
    fixture: 'docs/dental-reference/reference-aligner.stl',
  },
];

export const profileById = (id: string | undefined): AlignerProfile | undefined => ALIGNER_PROFILES.find((profile) => profile.id === id);

/** Profiles a mesh without a central opening could be: the ones that do not insist on one. */
export const profilesWithoutOpening = (): readonly AlignerProfile[] => ALIGNER_PROFILES.filter((profile) => profile.opening !== 'yes');
