import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dentalInternals } from '../core/analysis/dentalEngine';
import type { Lang } from '../i18n';
import second from '../../crates/geometry-core/src/dental/profiles/testdata/second-aligner.json';
import { ALIGNER_PROFILES, parseAlignerProfile, profileById, profileData, profilesFrom, profilesWithoutOpening } from './alignerProfiles';
import { defaultDentalTuning, parseDentalTuning } from './tuning';

const FILES = import.meta.glob<unknown>('../../crates/geometry-core/src/dental/profiles/*.json', { eager: true, import: 'default' });

describe('aligner profiles', () => {
  it('list exactly the profiles the Rust core embeds (one source of truth: the JSON files)', () => {
    expect(ALIGNER_PROFILES.map((profile) => profile.id).sort()).toEqual([...dentalInternals().dental_profile_ids()].sort());
    expect(Object.keys(FILES).length).toBe(ALIGNER_PROFILES.length);
  });

  it('read every profile file strictly: an unknown or a missing key throws (Rust does the same)', () => {
    for (const [path, data] of Object.entries(FILES)) {
      expect(() => parseAlignerProfile(data, path)).not.toThrow();
      const record = data as Record<string, Record<string, unknown>>;
      expect(() => parseAlignerProfile({ ...record, extra: 1 }, path)).toThrow("unknown key 'extra'");
      const { matchMinDot: _dot, ...defaults } = record.defaults!;
      expect(() => parseAlignerProfile({ ...record, defaults }, path)).toThrow("missing key 'matchMinDot'");
      expect(() => parseAlignerProfile({ ...record, thresholds: { ...record.thresholds, surprise: 1 } }, path)).toThrow("unknown key 'surprise'");
      const { ja: _ja, ...name } = record.name!;
      expect(() => parseAlignerProfile({ ...record, name }, path)).toThrow("missing key 'ja'");
      expect(() => parseAlignerProfile({ ...record, supports: { ...record.supports, roof: true } }, path)).toThrow("unknown key 'roof'");
      expect(() => parseAlignerProfile({ ...record, supports: { ...record.supports, tree: 1 } }, path)).toThrow('tree must be true or false');
      expect(() => parseAlignerProfile({ ...record, supports: { ...record.supports, liftHeightMm: -1 } }, path)).toThrow('liftHeightMm must be a positive number');
    }
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
    expect(() => profileData('no-such-aligner')).toThrow('unknown aligner profile');
  });

  it('a second profile file is all a new aligner type needs: card, defaults and limits follow', () => {
    const files = { ...FILES, '../../crates/geometry-core/src/dental/profiles/test-second-aligner.json': second };
    const profiles = profilesFrom(files);
    const added = profiles.find((profile) => profile.id === 'test-second-aligner');
    expect(added?.opening).toBe('either');
    expect(added?.defaults).toMatchObject({ positionMm: 0.8, outerSpacingMm: 4.5, repairBudget: 3, matchToleranceMm: 0.05 });
    expect(() => profilesFrom({ '../profiles/misnamed.json': second })).toThrow('named after its id');
    // The tuning helpers read whichever profile the policy names (the registered set here).
    expect(defaultDentalTuning('reference-aligner')).toEqual({ positionMm: 0.25, stripWidthMm: 0.5, density: 1 });
    expect(() => parseDentalTuning(defaultDentalTuning('reference-aligner'), 'test-second-aligner')).toThrow('unknown aligner profile');
  });
});
