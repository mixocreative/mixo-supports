import { describe, expect, it } from 'vitest';
import { GLOSSARY, ZONE_ONLY_WORDS, ZONE_TEXTS } from './glossary';
import { DICTIONARY } from './i18n';

declare global {
  interface ImportMeta {
    glob<T>(patterns: string[], options: { query: string; import: string; eager: true }): Record<string, T>;
  }
}

const GLOSSARY_MD = import.meta.glob<string>(['../docs/migration/glossary.md'], { query: '?raw', import: 'default', eager: true })['../docs/migration/glossary.md']!;
const KEYS = Object.keys(DICTIONARY['zh-Hant']);
/** Migration docs that name the UI's tool words. */
const DOCS = import.meta.glob<string>(['../docs/migration/*.md'], { query: '?raw', import: 'default', eager: true });

describe('glossary', () => {
  it('every translation of a key naming a concept uses that concept term', () => {
    const problems: string[] = [];
    for (const entry of GLOSSARY) {
      for (const key of KEYS) {
        if (!entry.en.test(key) || entry.except?.includes(key)) continue;
        const zh = DICTIONARY['zh-Hant'][key]!;
        const ja = DICTIONARY.ja[key]!;
        if (!entry.zh.some((term) => zh.includes(term))) problems.push(`${entry.concept} zh: ${key} → ${zh}`);
        if (!entry.ja.some((term) => ja.includes(term))) problems.push(`${entry.concept} ja: ${key} → ${ja}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('no translation uses a synonym the glossary rules out', () => {
    const problems: string[] = [];
    for (const entry of GLOSSARY) {
      for (const [lang, words] of [['zh-Hant', entry.avoid?.zh ?? []], ['ja', entry.avoid?.ja ?? []]] as const) {
        for (const [key, value] of Object.entries(DICTIONARY[lang])) {
          for (const word of words) if (value.includes(word)) problems.push(`${entry.concept} ${lang}: "${word}" in ${key} → ${value}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('Paint, Erase and Brush only name no-support zone tools', () => {
    expect(KEYS.filter((key) => ZONE_ONLY_WORDS.test(key) && !/\bzones?\b/i.test(key) && !ZONE_TEXTS.includes(key))).toEqual([]);
  });

  it('the docs call the Drag over size control by its UI name, Circle size (never the retired "Size")', () => {
    // cia 2026-10-22: the slider was renamed Size -> Circle size; one doc kept the old tool word.
    expect(DICTIONARY['zh-Hant']['Circle size']).toBeDefined();
    expect(DICTIONARY['zh-Hant']['Size']).toBeUndefined();
    for (const [path, text] of Object.entries(DOCS)) {
      expect(text, path).not.toMatch(/Drag over \/ Size\b/);
      if (/Select \/ Drag over/.test(text)) expect(text, path).toMatch(/Select \/ Drag over \/ Circle size/);
    }
  });

  it('the readable glossary lists every concept with its terms', () => {
    for (const entry of GLOSSARY) {
      const row = GLOSSARY_MD.split('\n').find((line) => line.startsWith(`| ${entry.concept} |`));
      expect(row, entry.concept).toBeDefined();
      for (const term of [...entry.zh, ...entry.ja]) expect(row, `${entry.concept}: ${term}`).toContain(term);
    }
  });
});
