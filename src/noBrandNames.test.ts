import { describe, expect, it } from 'vitest';

const BRANDS = /chitubox|lychee|prusaslicer|uvtools/i;

const TEXTS = import.meta.glob<string>(
  ['./**/*.{ts,tsx,css,json,snap}', '../README*.md', '!./noBrandNames.test.ts'],
  { query: '?raw', import: 'default', eager: true },
);

describe('third-party slicer brand names', () => {
  it('appear nowhere in src, the locales or the READMEs', () => {
    expect(Object.keys(TEXTS).length).toBeGreaterThan(50);
    const hits = Object.entries(TEXTS).filter(([, text]) => BRANDS.test(text)).map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
