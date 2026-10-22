import { describe, expect, it } from 'vitest';
import { parseTerms, termsFor } from './termsText';

describe('terms text', () => {
  it('parses the shipped terms into a title, numbered items and a working link', () => {
    for (const lang of ['en', 'zh-Hant'] as const) {
      const blocks = parseTerms(termsFor(lang).text);
      expect(blocks.filter((b) => b.kind === 'title')).toHaveLength(1);
      expect(blocks.filter((b) => b.kind === 'item')).toHaveLength(8);
      const links = blocks.flatMap((b) => ('inline' in b ? b.inline : [])).filter((p) => p.href);
      expect(links.map((p) => p.href)).toEqual(['THIRD-PARTY-NOTICES.txt']);
    }
  });

  it('falls back to the English text for Japanese and says so', () => {
    expect(termsFor('ja')).toEqual({ text: termsFor('en').text, translated: false });
  });

  it('names no font service, since the fonts are bundled', () => {
    expect(termsFor('en').text + termsFor('zh-Hant').text).not.toMatch(/font|字型|<!--/i);
  });
});
