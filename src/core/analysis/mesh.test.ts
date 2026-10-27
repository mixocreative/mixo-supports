import { describe, expect, it } from 'vitest';
import { labelForIndex } from './mesh';

describe('labelForIndex', () => {
  it('formats zero-based indices as spreadsheet-style labels', () => {
    expect(labelForIndex(0)).toBe('A');
    expect(labelForIndex(25)).toBe('Z');
    expect(labelForIndex(26)).toBe('AA');
    expect(labelForIndex(27)).toBe('AB');
    expect(labelForIndex(701)).toBe('ZZ');
  });
});
