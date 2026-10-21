import { describe, expect, it } from 'vitest';
import { enterActsOn, type KeyTarget } from './keys';

function element(tagName: string, attributes: Record<string, string> = {}): KeyTarget {
  return {
    tagName,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => name in attributes,
  };
}

describe('enterActsOn', () => {
  it('leaves Enter to buttons, links, summaries and custom controls', () => {
    expect(enterActsOn(element('BUTTON'))).toBe(true);
    expect(enterActsOn(element('A', { href: '#' }))).toBe(true);
    expect(enterActsOn(element('SUMMARY'))).toBe(true);
    expect(enterActsOn(element('DIV', { role: 'button' }))).toBe(true);
    expect(enterActsOn(element('SPAN', { tabindex: '0' }))).toBe(true);
    expect(enterActsOn(element('LI', { tabindex: '-1' }))).toBe(true);
    // An SVG link reports its tag name in lower case.
    expect(enterActsOn(element('a'))).toBe(true);
  });

  it('gives the editor Enter anywhere else', () => {
    expect(enterActsOn(null)).toBe(false);
    expect(enterActsOn({} as KeyTarget)).toBe(false);
    expect(enterActsOn(element('BODY'))).toBe(false);
    expect(enterActsOn(element('CANVAS'))).toBe(false);
    expect(enterActsOn(element('DIV', { role: 'group' }))).toBe(false);
  });
});
