import { describe, expect, it } from 'vitest';
import { escapeValue, formatNumber, parseNumber, readNumberInput, stepNumber } from './numberInput';

describe('parseNumber', () => {
  it.each([
    ['2', 2], ['2.5', 2.5], [' 2.5 ', 2.5], ['2mm', 2], ['2 mm', 2], ['2 MM', 2], ['2,5', 2.5], ['2,5 mm', 2.5],
    ['２．５', 2.5], ['２，５ｍｍ', 2.5], ['４５°', 45], ['３０％', 30], ['　2 mm　', 2],
    ['45°', 45], ['45 °', 45], ['45deg', 45], ['30%', 30], ['30 %', 30], ['-1.5', -1.5], ['+3', 3], ['.5', 0.5], ['5.', 5], ['1e1', 10],
  ])('reads %j as %d', (text, value) => {
    expect(parseNumber(text)).toBe(value);
  });

  it.each(['', '   ', 'mm', 'abc', '2 cm', '1.000,5', '2..5', '2,5,1', '--1', 'NaN', 'Infinity', '1/2'])('rejects %j', (text) => {
    expect(parseNumber(text)).toBeUndefined();
  });
});

describe('readNumberInput', () => {
  const limits = { min: 0.05, max: 10 };

  it('takes a value inside the limits as it is', () => {
    expect(readNumberInput('2,5 mm', limits)).toEqual({ value: 2.5, clamped: false });
  });

  it('clamps to the limits instead of rejecting', () => {
    expect(readNumberInput('0', limits)).toEqual({ value: 0.05, clamped: true });
    expect(readNumberInput('25mm', limits)).toEqual({ value: 10, clamped: true });
  });

  it('rounds whole-number settings', () => {
    expect(readNumberInput('12.6', { min: 3, max: 64, integer: true })).toEqual({ value: 13, clamped: true });
    expect(readNumberInput('12', { min: 3, max: 64, integer: true })).toEqual({ value: 12, clamped: false });
  });

  it('gives nothing for text that is not a number (the field keeps its value)', () => {
    expect(readNumberInput('two', limits)).toBeUndefined();
  });
});

describe('stepNumber', () => {
  it('steps up and down by the step, within the limits, without float noise', () => {
    expect(stepNumber(0.1, 0.1, 1, { min: 0, max: 1 })).toBe(0.2);
    expect(stepNumber(0.3, 0.1, -1, { min: 0, max: 1 })).toBe(0.2);
    expect(stepNumber(0.95, 0.1, 1, { min: 0, max: 1 })).toBe(1);
    expect(stepNumber(0, 0.1, -1, { min: 0, max: 1 })).toBe(0);
  });
});

describe('formatNumber', () => {
  it('shows at most four decimals and no trailing zeros', () => {
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(0.123456)).toBe('0.1235');
    expect(formatNumber(3)).toBe('3');
  });
});

describe('escapeValue', () => {
  it('Esc puts back the value the field had on focus, even after live edits applied', () => {
    expect(escapeValue(2, 2.5)).toBe(2);
    expect(escapeValue(2, 2)).toBeUndefined();
    expect(escapeValue(undefined, 2)).toBeUndefined();
  });
});
