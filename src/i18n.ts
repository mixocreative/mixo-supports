/**
 * UI language: English, Traditional Chinese (Taiwan) or Japanese. English text is the key;
 * a missing translation falls back to it. The choice is remembered in localStorage; without
 * one the browser language decides. Terms follow the Blender add-on (mixo3d/i18n_dict.py) and
 * Chitubox's own wording. The translations live in src/locales, one file per language.
 */
import { ja } from './locales/ja';
import { zhHant } from './locales/zh-Hant';

export type Lang = 'en' | 'zh-Hant' | 'ja';
export type Vars = Record<string, string | number>;

/** `name` is the language's own name, the hover hint of its button. */
export const LANGS: readonly { lang: Lang; label: string; name: string }[] = [
  { lang: 'en', label: 'EN', name: 'English' },
  { lang: 'zh-Hant', label: '中文', name: '繁體中文' },
  { lang: 'ja', label: '日本語', name: '日本語' },
];

const STORAGE_KEY = 'mixo-supports.lang';

/** Saved choice, else the first browser language we speak, else English. */
export function detectLanguage(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh-Hant' || saved === 'ja') return saved;
  } catch { /* storage blocked: fall through */ }
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const code = tag.toLowerCase();
    if (code.startsWith('zh')) return 'zh-Hant';
    if (code.startsWith('ja')) return 'ja';
    if (code.startsWith('en')) return 'en';
  }
  return 'en';
}

let current: Lang = 'en';

export function setLanguage(lang: Lang, remember = false): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (!remember) return;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch { /* storage blocked: the choice lasts this visit */ }
}

/** Translate `key` and fill `{name}` placeholders. */
export function t(key: string, vars?: Vars): string {
  const text = current === 'en' ? key : DICTIONARY[current][key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}

/** `one` for a count of 1, else `other`; both may use `{n}`. */
export function plural(n: number, one: string, other: string, vars?: Vars): string {
  return t(n === 1 ? one : other, { n, ...vars });
}

/** A status line kept as key + values so it re-translates when the language changes. */
export interface Message {
  key: string;
  vars?: Vars;
  /** Pick `other` instead of `key` when vars.n is not 1. */
  other?: string;
}

export function translateMessage(message: Message): string {
  const n = message.vars?.n;
  return message.other && typeof n === 'number' ? plural(n, message.key, message.other, message.vars) : t(message.key, message.vars);
}

/** Progress stages posted by the workers (translated where they are shown). */
export const STAGE_KEYS = [
  'Queued', 'Done', 'Finding overhangs', 'Remeshing the model', 'Scattering contacts', 'Finding lowest points',
  'Reinforcing edges', 'Collecting contacts', 'Sampling surface normals', 'Laying out trees', 'Building trees',
  'Building columns', 'Building raft and bracing', 'Finding unsupported islands', 'Checking overhang coverage',
  'Grouping problems', 'Writing STL', 'Parsing STL', 'Welding vertices', 'Reading file', 'Parsing glTF',
  'Simplifying display copy', 'Building pick index',
] as const;

export type Dictionary = Record<string, string>;

export const DICTIONARY: Record<Exclude<Lang, 'en'>, Dictionary> = { 'zh-Hant': zhHant, ja };
