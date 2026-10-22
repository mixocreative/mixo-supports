import { describe, expect, it } from 'vitest';
import { CLICK_TOLERANCE, clickTool, missAction, pickAction, type PickAction, type PickInput } from './pick';

const base: PickInput = {
  hit: 'model', button: 'left', ctrl: false, shift: false, travel: 0,
  mode: 'edit', tool: 'add', selectStyle: 'click', active: true, contact: true,
};
const pick = (change: Partial<PickInput>) => pickAction({ ...base, ...change });

describe('pickAction', () => {
  // Every branch of a click on a model or a support: mode × tool × button × modifier × hit.
  const rows: [string, Partial<PickInput>, PickAction][] = [
    // Outside the modes: the model selects its object, a right-click does nothing.
    ['off: click selects the object', { mode: 'off' }, { type: 'select', additive: false }],
    ['off: Shift+click adds to the selection', { mode: 'off', shift: true }, { type: 'select', additive: true }],
    ['off: Ctrl+click is a plain select', { mode: 'off', ctrl: true }, { type: 'select', additive: false }],
    ['off: right-click is taken, nothing happens', { mode: 'off', button: 'right' }, { type: 'none' }],
    ['off: inactive object selects too', { mode: 'off', active: false }, { type: 'select', additive: false }],
    ['off: supports take no clicks', { mode: 'off', hit: 'support' }, { type: 'pass' }],
    // A drag (orbit) is never a click.
    ['an orbit drag is no click', { travel: CLICK_TOLERANCE + 0.5 }, { type: 'pass' }],
    ['a small wobble still clicks', { travel: CLICK_TOLERANCE }, { type: 'add' }],
    ['an orbit drag over a support is no click', { hit: 'support', button: 'right', travel: 10 }, { type: 'pass' }],
    // Zones mode: the zone brush owns the model.
    ['zones: click on the model does nothing', { mode: 'zones' }, { type: 'none' }],
    ['zones: right-click does nothing', { mode: 'zones', button: 'right' }, { type: 'none' }],
    ['zones: supports take no clicks', { mode: 'zones', hit: 'support' }, { type: 'pass' }],
    // Edit Mode on another object: it becomes the one clicked (App refuses and says why).
    ['edit: another object is selected', { active: false }, { type: 'select', additive: false }],
    ['edit: Shift on another object is still a plain select', { active: false, shift: true }, { type: 'select', additive: false }],
    ['edit: right-click on another object selects it', { active: false, button: 'right' }, { type: 'select', additive: false }],
    ['edit: supports of another object pass through', { active: false, hit: 'support', button: 'right' }, { type: 'pass' }],
    // Add supports.
    ['add: click on the model adds', {}, { type: 'add' }],
    ['add: Ctrl+click on the model erases', { ctrl: true }, { type: 'erase' }],
    ['add: right-click on the model erases', { button: 'right' }, { type: 'erase' }],
    ['add: click on a support passes to the model behind', { hit: 'support' }, { type: 'pass' }],
    ['add: Ctrl+click on a support removes it', { hit: 'support', ctrl: true }, { type: 'removeContact' }],
    ['add: right-click on a support removes it', { hit: 'support', button: 'right' }, { type: 'removeContact' }],
    ['add: braces and raft pass through', { hit: 'support', button: 'right', contact: false }, { type: 'pass' }],
    // Select supports → Click.
    ['click: click on the model says to click a support', { tool: 'select' }, { type: 'miss' }],
    ['click: Ctrl+click on the model is a miss too', { tool: 'select', ctrl: true }, { type: 'miss' }],
    ['click: right-click on the model erases', { tool: 'select', button: 'right' }, { type: 'erase' }],
    ['click: click on a support toggles it', { tool: 'select', hit: 'support' }, { type: 'toggle' }],
    ['click: Ctrl+click on a support toggles it', { tool: 'select', hit: 'support', ctrl: true }, { type: 'toggle' }],
    ['click: right-click on a support removes it', { tool: 'select', hit: 'support', button: 'right' }, { type: 'removeContact' }],
    ['click: a brace passes through to the model', { tool: 'select', hit: 'support', contact: false }, { type: 'pass' }],
    // Select supports → Drag over: the stroke owns the left button.
    ['drag over: click on the model does nothing', { tool: 'select', selectStyle: 'brush' }, { type: 'none' }],
    ['drag over: right-click on the model erases', { tool: 'select', selectStyle: 'brush', button: 'right' }, { type: 'erase' }],
    ['drag over: click on a support passes through', { tool: 'select', selectStyle: 'brush', hit: 'support' }, { type: 'pass' }],
    ['drag over: Ctrl+click on a support passes through', { tool: 'select', selectStyle: 'brush', hit: 'support', ctrl: true }, { type: 'pass' }],
    ['drag over: right-click on a support removes it', { tool: 'select', selectStyle: 'brush', hit: 'support', button: 'right' }, { type: 'removeContact' }],
    // The select style only matters to Select supports.
    ['add ignores the select style', { selectStyle: 'brush' }, { type: 'add' }],
  ];

  it.each(rows)('%s', (_, change, expected) => {
    expect(pick(change)).toEqual(expected);
  });
});

describe('missAction', () => {
  it('a click on empty space says what to click in a mode, else clears the selection on a left click', () => {
    expect(missAction({ mode: 'edit', button: 'left', gizmoDragging: false })).toEqual({ type: 'miss' });
    expect(missAction({ mode: 'zones', button: 'right', gizmoDragging: false })).toEqual({ type: 'miss' });
    expect(missAction({ mode: 'off', button: 'left', gizmoDragging: false })).toEqual({ type: 'deselect' });
    expect(missAction({ mode: 'off', button: 'right', gizmoDragging: false })).toEqual({ type: 'none' });
    expect(missAction({ mode: 'off', button: 'middle', gizmoDragging: false })).toEqual({ type: 'none' });
  });

  it('the end of a gizmo drag is no click', () => {
    expect(missAction({ mode: 'off', button: 'left', gizmoDragging: true })).toEqual({ type: 'none' });
    expect(missAction({ mode: 'edit', button: 'left', gizmoDragging: true })).toEqual({ type: 'none' });
  });
});

describe('clickTool', () => {
  it('takes the tool and select style from the live session, not the step-behind canvas (a click right after Select supports must not add a support)', () => {
    expect(clickTool({ tool: 'select', selectStyle: 'click' }, { tool: 'add', brush: false })).toEqual({ tool: 'select', selectStyle: 'click' });
    // The live session carries more (its mode, its selection): only the tool is taken from it.
    const session = { mode: 'zones' as const, tool: 'add' as const, selectStyle: 'brush' as const };
    expect(clickTool(session, { tool: 'select', brush: false })).toEqual({ tool: 'add', selectStyle: 'brush' });
  });

  it('falls back to what the canvas rendered without a live session', () => {
    expect(clickTool(undefined, { tool: 'select', brush: true })).toEqual({ tool: 'select', selectStyle: 'brush' });
    expect(clickTool(undefined, { tool: 'add', brush: false })).toEqual({ tool: 'add', selectStyle: 'click' });
  });
});
