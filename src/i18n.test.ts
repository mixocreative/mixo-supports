import { afterEach, describe, expect, it } from 'vitest';
import { PRESET_HINTS, ROOF_HINTS, SETTING_GROUPS } from './components/SettingsPanel';
import { CodedError, ERROR_CODES, ERROR_CONTEXTS, errorStatus } from './editing/errors';
import { undoToast } from './editing/toast';
import { DICTIONARY, STAGE_KEYS, detectLanguage, plural, setLanguage, t, translateMessage } from './i18n';

/** Source text of every non-test module, keyed './path'. */
const SOURCES = import.meta.glob<string>(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });
const UI_FILES = ['./App.tsx', './components/RangeField.tsx', './components/Segmented.tsx', './components/SettingsPanel.tsx', './components/JobActivity.tsx', './components/ObjectViewport.tsx', './components/UndoToast.tsx', './editing/status.ts', './editing/errors.ts', './editing/toast.ts', './editing/check.ts', './editing/modeButtons.ts', './editing/view.ts'];
/** Quoted literals in UI files that are not shown to the user. */
const NOT_UI = new Set(['Tab', 'Escape', 'Enter', 'Delete', 'Backspace', 'Unit', 'Mixo supports', 'ArrowUp', 'ArrowDown', 'CodedError', 'TimeoutError', '{error}', 'AbortError']);

/** Single-quoted literals that read like UI text: a lowercase letter and a space or capital start. */
function uiLiterals(code: string): string[] {
  return [...code.matchAll(/'((?:[^'\\\n]|\\.)+)'/g)].map((match) => match[1]!)
    .filter((text) => /[a-z]/.test(text) && (/^[A-Z{]/.test(text) || / /.test(text)))
    // Not code between two literals, a path, a MIME type or a lowercase class list.
    .filter((text) => !/[=()<>]|^[\s}.,/]|^\w+\/|^[a-z -]+$/.test(text));
}

describe('i18n', () => {
  afterEach(() => setLanguage('en'));

  it('translates every UI string into Chinese and Japanese', () => {
    const keys = new Set<string>([...STAGE_KEYS]);
    for (const file of UI_FILES) {
      const code = SOURCES[file]!.replace(/^import .*$/gm, '');
      uiLiterals(code).filter((text) => !NOT_UI.has(text) && !text.includes('${')).forEach((text) => keys.add(text));
      // Hover hints and export hints, parentheses included (uiLiterals skips text with brackets).
      for (const match of code.matchAll(/(?:hint\(|hint: )'([^'\n]+)'/g)) keys.add(match[1]!);
      for (const match of code.matchAll(/hint\([^)]*?\? '([^']+)' : '([^']+)'/g)) keys.add(match[1]!).add(match[2]!);
    }
    [...Object.values(PRESET_HINTS), ...Object.values(ROOF_HINTS)].forEach((text) => keys.add(text));
    for (const context of ERROR_CONTEXTS) for (const code of ERROR_CODES) keys.add(errorStatus(context, new CodedError(code, 'x')).key);
    for (const action of [{ kind: 'clearZones' }, { kind: 'clearManual' }, { kind: 'clearSelection', ids: ['a'], unitId: 'u' }] as const) {
      const { message } = undoToast(1, action);
      keys.add(message.key);
      if (message.other) keys.add(message.other);
    }
    for (const group of SETTING_GROUPS) {
      keys.add(group.title);
      for (const field of group.fields) {
        keys.add(field.label);
        if ('hint' in field && field.hint) keys.add(field.hint);
        if (field.kind === 'text') keys.add(field.placeholder);
        if (field.kind === 'choice') field.options.forEach((option) => keys.add(option.label));
      }
    }
    expect(keys.size).toBeGreaterThan(150);
    for (const [lang, dictionary] of Object.entries(DICTIONARY)) {
      expect([...keys].filter((key) => !(key in dictionary)), lang).toEqual([]);
    }
  });

  it('knows every progress stage the workers post', () => {
    const stages = new Set<string>();
    for (const code of Object.values(SOURCES)) {
      for (const match of code.matchAll(/[pP]rogress\??\.?\(\s*[^,()]+(?:\([^)]*\))?[^,()]*,\s*'([^']+)'/g)) stages.add(match[1]!);
    }
    expect(stages.size).toBeGreaterThan(5);
    expect([...stages].filter((stage) => !(STAGE_KEYS as readonly string[]).includes(stage))).toEqual([]);
  });

  it('keeps the same placeholders in every translation', () => {
    for (const [lang, dictionary] of Object.entries(DICTIONARY)) {
      for (const [key, value] of Object.entries(dictionary)) {
        const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
        expect(names(value), `${lang}: ${key}`).toEqual(names(key));
      }
    }
  });

  it('fills placeholders, picks plurals and falls back to English', () => {
    expect(t('{n} triangles', { n: 12 })).toBe('12 triangles');
    expect(plural(1, '1 object', '{n} objects')).toBe('1 object');
    expect(plural(3, '1 object', '{n} objects')).toBe('3 objects');
    setLanguage('ja');
    expect(t('{n} objects', { n: 3 })).toBe('3 個のオブジェクト');
    expect(translateMessage({ key: 'Deleted 1 object (undo restores).', vars: { n: 2 }, other: 'Deleted {n} objects (undo restores).' })).toBe('2 個のオブジェクトを削除しました（元に戻せます）。');
    expect(t('Not a key')).toBe('Not a key');
    setLanguage('zh-Hant');
    expect(t('Support Edit Mode')).toBe('支撐編輯模式');
  });

  it('detects the language from storage, then the browser', () => {
    const languages = (list: string[]) => Object.defineProperty(globalThis, 'navigator', { value: { languages: list, language: list[0] }, configurable: true });
    languages(['ja-JP', 'en']);
    expect(detectLanguage()).toBe('ja');
    languages(['zh-TW']);
    expect(detectLanguage()).toBe('zh-Hant');
    languages(['de-DE', 'zh-CN']);
    expect(detectLanguage()).toBe('zh-Hant');
    languages(['fr']);
    expect(detectLanguage()).toBe('en');
  });
});
