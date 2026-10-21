import { describe, expect, it } from 'vitest';
import { enterActsOn, keyAction, type KeyAction, type KeyInput, type KeyTarget } from './keys';
import type { EditMode } from './types';

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

describe('keyAction', () => {
  const none: KeyAction = { type: 'none', preventDefault: false };
  const press = (key: string, mode: EditMode, options: Partial<KeyInput> = {}) =>
    keyAction({ key, ctrl: false, shift: false, target: null, mode, hasSelection: false, ...options });

  // Every row of the editor's key handler: key × mode × modifier, selection and focus guards.
  const rows: [string, string, EditMode, Partial<KeyInput>, KeyAction][] = [
    ['Ctrl+Z undoes', 'z', 'off', { ctrl: true }, { type: 'undo', preventDefault: true }],
    ['Ctrl+Z undoes in Edit Mode', 'z', 'edit', { ctrl: true }, { type: 'undo', preventDefault: true }],
    ['Ctrl+Z undoes in zones mode', 'z', 'zones', { ctrl: true }, { type: 'undo', preventDefault: true }],
    ['Ctrl+Shift+Z redoes', 'Z', 'off', { ctrl: true, shift: true }, { type: 'redo', preventDefault: true }],
    ['Ctrl+Y redoes', 'y', 'edit', { ctrl: true }, { type: 'redo', preventDefault: true }],
    ['Ctrl+Y redoes (caps)', 'Y', 'zones', { ctrl: true }, { type: 'redo', preventDefault: true }],
    ['plain Z does nothing', 'z', 'off', {}, none],
    ['Tab toggles Edit Mode', 'Tab', 'off', {}, { type: 'toggleEdit', preventDefault: true }],
    ['Tab leaves Edit Mode', 'Tab', 'edit', { hasSelection: true }, { type: 'toggleEdit', preventDefault: true }],
    ['Tab is swallowed in zones mode', 'Tab', 'zones', {}, { type: 'none', preventDefault: true }],
    ['Esc closes zones mode', 'Escape', 'zones', {}, { type: 'leaveMode', preventDefault: true }],
    ['Enter closes zones mode', 'Enter', 'zones', {}, { type: 'leaveMode', preventDefault: true }],
    ['Enter on a button stays in zones mode', 'Enter', 'zones', { target: element('BUTTON') }, none],
    ['Delete with a selection deletes it', 'Delete', 'edit', { hasSelection: true }, { type: 'deleteSelection', preventDefault: true }],
    ['Backspace with a selection deletes it', 'Backspace', 'edit', { hasSelection: true }, { type: 'deleteSelection', preventDefault: true }],
    ['Esc with a selection clears it', 'Escape', 'edit', { hasSelection: true }, { type: 'clearSelection', preventDefault: true }],
    ['Enter with a selection leaves Edit Mode', 'Enter', 'edit', { hasSelection: true }, { type: 'leaveMode', preventDefault: true }],
    ['Esc leaves Edit Mode', 'Escape', 'edit', {}, { type: 'leaveMode', preventDefault: true }],
    ['Enter leaves Edit Mode', 'Enter', 'edit', {}, { type: 'leaveMode', preventDefault: true }],
    ['Enter on a custom control stays in Edit Mode', 'Enter', 'edit', { target: element('DIV', { tabindex: '0' }) }, none],
    ['Delete without a selection does nothing in Edit Mode', 'Delete', 'edit', {}, none],
    ['Backspace without a selection does nothing in Edit Mode', 'Backspace', 'edit', {}, none],
    ['Delete deletes objects', 'Delete', 'off', {}, { type: 'deleteObjects', preventDefault: false }],
    ['Backspace never deletes objects', 'Backspace', 'off', {}, none],
    ['Delete does nothing in zones mode', 'Delete', 'zones', { hasSelection: true }, none],
    ['Esc does nothing outside the modes', 'Escape', 'off', {}, none],
    ['Enter does nothing outside the modes', 'Enter', 'off', {}, none],
    ['G picks Move', 'g', 'off', {}, { type: 'gizmo', mode: 'translate', preventDefault: false }],
    ['Shift+G picks Move', 'G', 'off', { shift: true }, { type: 'gizmo', mode: 'translate', preventDefault: false }],
    ['Ctrl+G picks Move too', 'g', 'off', { ctrl: true }, { type: 'gizmo', mode: 'translate', preventDefault: false }],
    ['R picks Rotate', 'r', 'off', {}, { type: 'gizmo', mode: 'rotate', preventDefault: false }],
    ['G does nothing in Edit Mode', 'g', 'edit', {}, none],
    ['R does nothing in zones mode', 'r', 'zones', {}, none],
    ['typing in a field is left alone', 'Delete', 'off', { target: element('INPUT') }, none],
    ['Ctrl+Z in a text area is left alone', 'z', 'edit', { ctrl: true, target: element('TEXTAREA') }, none],
    ['Tab in a select is left alone', 'Tab', 'off', { target: element('SELECT') }, none],
    ['other keys do nothing', 'x', 'off', {}, none],
  ];

  it.each(rows)('%s', (_, key, mode, options, expected) => {
    expect(press(key, mode, options)).toEqual(expected);
  });

  it('takes the document (no element focused) as no field', () => {
    expect(press('Enter', 'edit', { target: {} as KeyTarget })).toEqual({ type: 'leaveMode', preventDefault: true });
  });
});
