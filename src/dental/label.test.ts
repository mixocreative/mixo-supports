import { describe, expect, it } from 'vitest';
import { dentalLabelOf, DEFAULT_DENTAL_LABEL, DENTAL_LABEL_MAX, filterDentalLabel } from './label';
import FONT from '../../crates/geometry-core/src/supports/parts/labelFont.json';

describe('dental label field', () => {
  it('uppercases letters and drops everything but A-Z 0-9 and -', () => {
    expect(filterDentalLabel('ab-12')).toBe('AB-12');
    expect(filterDentalLabel('a b_c.d/é!ß🙂')).toBe('ABCD');
    expect(filterDentalLabel('  x ')).toBe('X');
    expect(filterDentalLabel('')).toBe('');
  });
  it('holds at most 8 characters, counted after the filter', () => {
    expect(DENTAL_LABEL_MAX).toBe(8);
    expect(filterDentalLabel('abcdefghijkl')).toBe('ABCDEFGH');
    expect(filterDentalLabel('a b c d e f g h i j')).toBe('ABCDEFGH');
  });
  it('defaults to X when the field is empty', () => {
    expect(DEFAULT_DENTAL_LABEL).toBe('X');
    expect(dentalLabelOf('')).toBe('X');
    expect(dentalLabelOf(undefined)).toBe('X');
    expect(dentalLabelOf('l-2')).toBe('L-2');
  });
  it('the label font already has a glyph for every allowed character (no data to add)', () => {
    const glyphs = (FONT as unknown as { glyphs: Record<string, unknown> }).glyphs;
    for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-') expect(glyphs[character], character).toBeDefined();
  });
});
