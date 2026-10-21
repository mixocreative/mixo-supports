import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import type { JobRow } from '../workers/jobActivity';
import { failureText, rowText } from './JobActivity';

const row = (overrides: Partial<JobRow>): JobRow => ({
  id: 1, label: { key: 'Importing {name}', vars: { name: 'statue.stl' } }, stage: null, state: 'indeterminate', fraction: null, percent: null,
  elapsedMs: 500, showElapsed: false, remainingMs: null, cancellable: false, cancelling: false, blocking: false, context: 'import', error: null, ...overrides,
});

describe('job activity texts', () => {
  afterEach(() => setLanguage('en'));

  it('names what runs, then its stage, percent and time left', () => {
    expect(rowText(row({}))).toEqual({ label: 'Importing statue.stl…', meta: '' });
    expect(rowText(row({ state: 'determinate', stage: 'Welding vertices', percent: 40, remainingMs: 72_000 }))).toEqual({ label: 'Importing statue.stl · Welding vertices', meta: '40% · about 1 min 12 s left' });
    expect(rowText(row({ showElapsed: true, elapsedMs: 12_400 })).meta).toBe('12 s so far');
    expect(rowText(row({ cancelling: true })).meta).toBe('Cancelling…');
  });

  it('explains failures like the status line does (editing/errors), by context and code, in the chosen language', () => {
    expect(failureText(row({ state: 'failed', error: { code: 'timeout', message: 'Import timed out after 300000 ms' } }))).toBe('Importing statue.stl took too long and was stopped. Try again; if it happens again, simplify the model.');
    expect(failureText(row({ state: 'failed', error: { code: 'too-large', message: 'x', vars: { n: 9_991_920, limit: 6_000_000 } } }))).toBe(`statue.stl is too large to edit here: ${(9_991_920).toLocaleString()} triangles, the limit is ${(6_000_000).toLocaleString()}. Simplify the model, then import it again.`);
    expect(failureText(row({ state: 'failed', context: 'place', label: { key: 'Placing contacts on {name}', vars: { name: 'A part' } }, error: { code: 'crashed', message: 'Support analysis crashed' } }))).toBe('The support worker stopped unexpectedly. Supports are unchanged; generate again.');
    setLanguage('ja');
    expect(failureText(row({ state: 'failed', error: { code: 'bad-stl', message: 'damaged' } }))).not.toContain('damaged');
    setLanguage('zh-Hant');
    expect(rowText(row({ state: 'cancelled' })).label).toBe('正在匯入 statue.stl：已取消。');
  });
});
