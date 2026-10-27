import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dentalEngine } from '../core/analysis/dentalEngine';
import type { Lang } from '../i18n';
import { ALIGNER_PROFILES, profileById, profilesWithoutOpening } from './alignerProfiles';

describe('aligner profiles', () => {
  it('list exactly the profiles the Rust core embeds (one source of truth)', () => {
    expect(ALIGNER_PROFILES.map((profile) => profile.id).sort()).toEqual([...dentalEngine().dental_profile_ids()].sort());
  });

  it('carry a name, description and card for every locale, and a fixture that exists', () => {
    for (const profile of ALIGNER_PROFILES) {
      for (const lang of ['en', 'zh-Hant', 'ja'] as Lang[]) {
        expect(profile.name[lang], `${profile.id} name ${lang}`).toBeTruthy();
        expect(profile.description[lang], `${profile.id} description ${lang}`).toBeTruthy();
      }
      expect(profile.card.length).toBeGreaterThan(0);
      expect(() => readFileSync(profile.fixture)).not.toThrow();
    }
  });

  it('has the reference aligner as profile one, expecting a central opening', () => {
    expect(ALIGNER_PROFILES[0]?.id).toBe('reference-aligner');
    expect(profileById('reference-aligner')?.opening).toBe('yes');
    expect(profilesWithoutOpening()).toEqual([]);
  });
});
