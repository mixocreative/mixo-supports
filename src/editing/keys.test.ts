import { describe, expect, it } from 'vitest';
import { enterActsOn, keyAction, type KeyAction, type KeyInput, type KeyTarget } from './keys';
import type { EditMode } from './types';

function element(tagName: string, attributes: Record<string, string> = {}, type?: string): KeyTarget {
  return {
    tagName,
    ...(type ? { type } : {}),
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
    expect(enterActsOn(element('INPUT', {}, 'file'))).toBe(true);
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
  const none: KeyAction = { command: undefined, preventDefault: false };
  const press = (key: string, mode: EditMode, options: Partial<KeyInput> = {}) =>
    keyAction({ key, ctrl: false, shift: false, target: null, mode, hasSelection: false, ...options });

  // Every row of the editor's key handler: key × mode × modifier, selection and focus guards.
  const rows: [string, string, EditMode, Partial<KeyInput>, KeyAction][] = [
    ['Ctrl+Z undoes', 'z', 'off', { ctrl: true }, { command: 'history.undo', preventDefault: true }],
    ['Ctrl+Z undoes in Edit Mode', 'z', 'edit', { ctrl: true }, { command: 'history.undo', preventDefault: true }],
    ['Ctrl+Z undoes in zones mode', 'z', 'zones', { ctrl: true }, { command: 'history.undo', preventDefault: true }],
    ['Ctrl+Shift+Z redoes', 'Z', 'off', { ctrl: true, shift: true }, { command: 'history.redo', preventDefault: true }],
    ['Ctrl+Y redoes', 'y', 'edit', { ctrl: true }, { command: 'history.redo', preventDefault: true }],
    ['Ctrl+Y redoes (caps)', 'Y', 'zones', { ctrl: true }, { command: 'history.redo', preventDefault: true }],
    ['plain Z does nothing', 'z', 'off', {}, none],
    ['Tab is never a mode key outside the modes', 'Tab', 'off', {}, none],
    ['Tab is never a mode key in Edit Mode', 'Tab', 'edit', { hasSelection: true }, none],
    ['Tab is never a mode key in zones mode', 'Tab', 'zones', {}, none],
    ['Esc closes zones mode', 'Escape', 'zones', {}, { command: 'mode.exit', preventDefault: true }],
    ['Enter closes zones mode', 'Enter', 'zones', {}, { command: 'mode.exit', preventDefault: true }],
    ['Enter on a button stays in zones mode', 'Enter', 'zones', { target: element('BUTTON') }, none],
    ['Delete with a selection deletes it', 'Delete', 'edit', { hasSelection: true }, { command: 'edit.deleteSelection', preventDefault: true }],
    ['Backspace with a selection deletes it', 'Backspace', 'edit', { hasSelection: true }, { command: 'edit.deleteSelection', preventDefault: true }],
    ['Esc with a selection clears it', 'Escape', 'edit', { hasSelection: true }, { command: 'edit.clearSelection', preventDefault: true }],
    ['Enter with a selection leaves Edit Mode', 'Enter', 'edit', { hasSelection: true }, { command: 'mode.exit', preventDefault: true }],
    ['Esc leaves Edit Mode', 'Escape', 'edit', {}, { command: 'mode.exit', preventDefault: true }],
    ['Enter leaves Edit Mode', 'Enter', 'edit', {}, { command: 'mode.exit', preventDefault: true }],
    ['Enter on a custom control stays in Edit Mode', 'Enter', 'edit', { target: element('DIV', { tabindex: '0' }) }, none],
    ['Delete without a selection does nothing in Edit Mode', 'Delete', 'edit', {}, none],
    ['Backspace without a selection does nothing in Edit Mode', 'Backspace', 'edit', {}, none],
    ['Delete deletes objects', 'Delete', 'off', {}, { command: 'objects.delete', preventDefault: false }],
    ['Backspace never deletes objects', 'Backspace', 'off', {}, none],
    ['Delete does nothing in zones mode', 'Delete', 'zones', { hasSelection: true }, none],
    ['Esc does nothing outside the modes', 'Escape', 'off', {}, none],
    ['Enter does nothing outside the modes', 'Enter', 'off', {}, none],
    ['G picks Move', 'g', 'off', {}, { command: 'transform.move', preventDefault: false }],
    ['Shift+G picks Move', 'G', 'off', { shift: true }, { command: 'transform.move', preventDefault: false }],
    ['Ctrl+G picks Move too', 'g', 'off', { ctrl: true }, { command: 'transform.move', preventDefault: false }],
    ['R picks Rotate', 'r', 'off', {}, { command: 'transform.rotate', preventDefault: false }],
    ['G does nothing in Edit Mode', 'g', 'edit', {}, none],
    ['R does nothing in zones mode', 'r', 'zones', {}, none],
    ['typing in a field is left alone', 'Delete', 'off', { target: element('INPUT') }, none],
    ['Esc in a text field only affects the field', 'Escape', 'edit', { target: element('INPUT', {}, 'text') }, none],
    ['Esc in a number field only affects the field', 'Escape', 'zones', { target: element('INPUT', {}, 'number') }, none],
    ['Enter in a number field does not leave the mode', 'Enter', 'edit', { target: element('INPUT', {}, 'number') }, none],
    ['Esc in a select only affects the select', 'Escape', 'edit', { target: element('SELECT') }, none],
    ['a range does not swallow Esc', 'Escape', 'edit', { target: element('INPUT', {}, 'range') }, { command: 'mode.exit', preventDefault: true }],
    ['a range does not swallow Esc with a selection', 'Escape', 'edit', { hasSelection: true, target: element('INPUT', {}, 'range') }, { command: 'edit.clearSelection', preventDefault: true }],
    ['a range does not swallow Delete', 'Delete', 'edit', { hasSelection: true, target: element('INPUT', {}, 'range') }, { command: 'edit.deleteSelection', preventDefault: true }],
    ['a range does not swallow Delete outside the modes', 'Delete', 'off', { target: element('INPUT', {}, 'range') }, { command: 'objects.delete', preventDefault: false }],
    ['a checkbox does not swallow Enter', 'Enter', 'zones', { target: element('INPUT', {}, 'checkbox') }, { command: 'mode.exit', preventDefault: true }],
    ['a range keeps Ctrl+Z for the editor', 'z', 'edit', { ctrl: true, target: element('INPUT', {}, 'range') }, { command: 'history.undo', preventDefault: true }],
    ['Enter on a file input opens its chooser', 'Enter', 'edit', { target: element('INPUT', {}, 'file') }, none],
    ['Ctrl+Z in a text area is left alone', 'z', 'edit', { ctrl: true, target: element('TEXTAREA') }, none],
    ['Tab in a select is left alone', 'Tab', 'off', { target: element('SELECT') }, none],
    ['other keys do nothing', 'x', 'off', {}, none],
  ];

  it.each(rows)('%s', (_, key, mode, options, expected) => {
    expect(press(key, mode, options)).toEqual(expected);
  });

  it('takes the document (no element focused) as no field', () => {
    expect(press('Enter', 'edit', { target: {} as KeyTarget })).toEqual({ command: 'mode.exit', preventDefault: true });
  });
});
