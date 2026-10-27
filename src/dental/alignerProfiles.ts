import type { Lang } from '../i18n';

/**
 * The aligner types the dental flow offers (Step 0), read from the same JSON files the Rust core
 * embeds (`crates/geometry-core/src/dental/profiles/*.json`, one per type). Adding an aligner type
 * is adding one file there: this list, the card, the operator defaults and limits all follow, with
 * no code change. Parsing is strict like the Rust side (an unknown or a missing key throws), and
 * `alignerProfiles.test.ts` checks both read the same set.
 */
const FILES = import.meta.glob<unknown>('../../crates/geometry-core/src/dental/profiles/*.json', { eager: true, import: 'default' });

export interface ProfileDefaults {
  setbackMm: number;
  stripWidthMm: number;
  density: number;
  setbackMaxMm: number;
  stripWidthMinMm: number;
  stripWidthMaxMm: number;
  densityMin: number;
  densityMax: number;
  outerSpacingMm: number;
  innerSpacingMm: number;
  maxSearchMm: number;
  repairBudget: number;
  matchToleranceMm: number;
  matchMinDot: number;
}

/** One profile file as the host reads it (thresholds are the geometry's; the host only checks the keys). */
export interface AlignerProfileData {
  id: string;
  name: Record<Lang, string>;
  description: Record<Lang, string>;
  /** Whether this type has a central opening; Rust checks what Step 1 finds against it. */
  opening: 'yes' | 'no' | 'either';
  /** Top-view line art in a 120 by 90 box: SVG path data, stroked in the card's ink colour. */
  card: readonly string[];
  /** The reference scan this type is tuned and tested with. */
  fixture: string;
  thresholds: Readonly<Record<string, number>>;
  defaults: Readonly<ProfileDefaults>;
}

const LANGS: readonly Lang[] = ['en', 'ja', 'zh-Hant'];
const TOP_KEYS = ['id', 'name', 'description', 'opening', 'card', 'fixture', 'thresholds', 'defaults'];
const THRESHOLD_KEYS = ['axialVarianceMax', 'terminalAreaRatioMin', 'terminalBandFraction', 'confidenceMin', 'sharpAngleDeg',
  'loopMinVertices', 'loopBandFraction', 'loopBandMinMm', 'loopRadiusRatioMin', 'loopExtentMin', 'ridgeFirstMinEdges',
  'ridgeSecondMinEdges', 'ridgeExtentMin', 'connectorAngleDeg', 'openingResolutionLow', 'openingResolutionHigh',
  'openingHoleMinFraction', 'openingLoopMinEdges', 'regionAllowedMeanMin', 'regionForbiddenMeanMax',
  'regionAllowedFractionMin', 'regionAllowedFractionMax'];
const DEFAULT_KEYS: readonly (keyof ProfileDefaults)[] = ['setbackMm', 'stripWidthMm', 'density', 'setbackMaxMm', 'stripWidthMinMm',
  'stripWidthMaxMm', 'densityMin', 'densityMax', 'outerSpacingMm', 'innerSpacingMm', 'maxSearchMm', 'repairBudget',
  'matchToleranceMm', 'matchMinDot'];

function object(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${where} must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new TypeError(`${where}: unknown key '${key}'`);
  for (const key of keys) if (!(key in record)) throw new TypeError(`${where}: missing key '${key}'`);
  return record;
}

function numbers<K extends string>(value: unknown, keys: readonly K[], where: string): Record<K, number> {
  const record = object(value, keys, where);
  for (const key of keys) if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) throw new TypeError(`${where}.${key} must be a number`);
  return record as Record<K, number>;
}

function texts(value: unknown, where: string): Record<Lang, string> {
  const record = object(value, LANGS, where);
  for (const lang of LANGS) if (typeof record[lang] !== 'string') throw new TypeError(`${where}.${lang} must be text`);
  return record as Record<Lang, string>;
}

/** One profile file, strictly: every key the Rust struct has, nothing else. */
export function parseAlignerProfile(value: unknown, where = 'aligner profile'): AlignerProfileData {
  const record = object(value, TOP_KEYS, where);
  const { id, opening, card, fixture } = record;
  if (typeof id !== 'string' || id === '') throw new TypeError(`${where}.id must be text`);
  if (opening !== 'yes' && opening !== 'no' && opening !== 'either') throw new TypeError(`${where}.opening must be yes, no or either`);
  if (!Array.isArray(card) || card.some((path) => typeof path !== 'string')) throw new TypeError(`${where}.card must be SVG path data`);
  if (typeof fixture !== 'string') throw new TypeError(`${where}.fixture must be a path`);
  return {
    id, opening, card: [...card] as string[], fixture,
    name: texts(record.name, `${where}.name`), description: texts(record.description, `${where}.description`),
    thresholds: numbers(record.thresholds, THRESHOLD_KEYS, `${where}.thresholds`),
    defaults: numbers(record.defaults, DEFAULT_KEYS, `${where}.defaults`),
  };
}

/** The profiles of a set of files (path to parsed JSON), in file order; each file is named after its id. */
export function profilesFrom(files: Readonly<Record<string, unknown>>): AlignerProfileData[] {
  return Object.keys(files).sort().map((path) => {
    const profile = parseAlignerProfile(files[path], path);
    if (!path.endsWith(`/${profile.id}.json`)) throw new TypeError(`${path}: a profile file is named after its id`);
    return profile;
  });
}

const PROFILES: readonly AlignerProfileData[] = profilesFrom(FILES);

/** Profile #1, the one older saved projects (without a profile) were made with. */
export const DEFAULT_PROFILE_ID = 'reference-aligner';

/** The data of one profile; throws for an id no file defines. */
export function profileData(id: string): AlignerProfileData {
  const found = PROFILES.find((profile) => profile.id === id);
  if (!found) throw new TypeError(`unknown aligner profile '${id}'`);
  return found;
}

/** One Step 0 card. */
export type AlignerProfile = Pick<AlignerProfileData, 'id' | 'name' | 'description' | 'opening' | 'card' | 'fixture'>;

export const ALIGNER_PROFILES: readonly AlignerProfile[] = [...PROFILES]
  .sort((a, b) => Number(b.id === DEFAULT_PROFILE_ID) - Number(a.id === DEFAULT_PROFILE_ID))
  .map(({ id, name, description, opening, card, fixture }) => ({ id, name, description, opening, card, fixture }));

export const profileById = (id: string | undefined): AlignerProfile | undefined => ALIGNER_PROFILES.find((profile) => profile.id === id);

/** Profiles a mesh without a central opening could be: the ones that do not insist on one. */
export const profilesWithoutOpening = (): readonly AlignerProfile[] => ALIGNER_PROFILES.filter((profile) => profile.opening !== 'yes');
