import { describe, expect, it } from 'vitest';
import { SETTING_GROUPS } from './components/SettingsPanel';

const SOURCES = import.meta.glob<string>(['./App.tsx', './components/SettingsPanel.tsx', './components/UndoToast.tsx', './components/RangeField.tsx', './components/Segmented.tsx', './components/EditBar.tsx', './components/ZonesBar.tsx', './components/SurfaceBrushBar.tsx', './components/ModeEntry.tsx', './components/CommandButton.tsx', './components/ProblemList.tsx', './components/ObjectList.tsx'], { query: '?raw', import: 'default', eager: true });

/** Every JSX opening tag `<name …>` in `code`, attributes included (braces may hold `>`). */
function openingTags(code: string, name: string): string[] {
  const tags: string[] = [];
  for (let start = code.indexOf(`<${name}`); start >= 0; start = code.indexOf(`<${name}`, start + 1)) {
    if (/\w/.test(code[start + name.length + 1] ?? '')) continue; // <buttonGroup and the like
    let depth = 0;
    let end = start;
    for (; end < code.length; end++) {
      const char = code[end];
      if (char === '{') depth++;
      else if (char === '}') depth--;
      else if (char === '>' && depth === 0) break;
    }
    tags.push(code.slice(start, end + 1));
  }
  return tags;
}

const hinted = (tag: string) => /\btitle=|\{\.\.\.hint\(/.test(tag);

describe('hover hints', () => {
  it('finds the tool buttons and sliders', () => {
    expect(Object.values(SOURCES).flatMap((code) => openingTags(code, 'button')).length).toBeGreaterThan(8);
    expect(openingTags('<a onClick={() => x > 1}>', 'a')).toEqual(['<a onClick={() => x > 1}>']);
  });

  it('every tool button and slider has a hint (title and accessible description)', () => {
    // Choice and preview option buttons are values inside a hinted setting row (role="group" with the row's description).
    const missing = Object.entries(SOURCES).flatMap(([file, code]) => [
      ...openingTags(code, 'button'),
      ...openingTags(code, 'input').filter((tag) => tag.includes('type="range"')),
    ].filter((tag) => !hinted(tag) && !/key=\{option\.value\}|onChange\('previewMode'/.test(tag)).map((tag) => `${file}: ${tag.slice(0, 80)}`));
    expect(missing).toEqual([]);
  });

  it('every button that can be disabled comes from the registry, which says why it is off', () => {
    const own = Object.entries(SOURCES).filter(([file]) => !/CommandButton|Segmented/.test(file))
      .flatMap(([file, code]) => openingTags(code, 'button').filter((tag) => /disabled/.test(tag)).map((tag) => `${file}: ${tag.slice(0, 80)}`));
    expect(own).toEqual([]);
  });

  it('every setting has a hint', () => {
    expect(SETTING_GROUPS.flatMap((group) => group.fields).filter((field) => !('command' in field) && !('hint' in field && field.hint))).toEqual([]);
  });

  it('Overhang angle and Ridge angle say what lower and higher do', () => {
    const fields = SETTING_GROUPS.flatMap((group) => group.fields);
    for (const key of ['scatterAngle', 'scatterRidgeAngle']) {
      const field = fields.find((candidate) => candidate.key === key)!;
      const text = 'hint' in field ? field.hint : '';
      expect(text, key).toMatch(/lower/i);
      expect(text, key).toMatch(/higher/i);
    }
  });
});
