import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, resolve, type UiState } from './commands';
import { canvasGesture, gesture } from './gesture';
import { keyAction } from './keys';
import { initialSession, reduceSession, type EditSession, type SessionEvent } from './session';
import { READY } from './uiFixture';

const run = (state: EditSession, ...events: SessionEvent[]) => events.reduce(reduceSession, state);
const area = run(initialSession, { type: 'enterDental' }, { type: 'chooseDentalProfile', id: 'p' }, { type: 'dentalLoading', unitId: 'u1' },
  { type: 'dentalOriented', proposal: {} as never, notices: [] }, { type: 'acceptDentalOrientation' });
const ui = (over: Partial<UiState>): UiState => ({ ...READY, mode: 'dental', dentalStage: 'area', ...over });

describe('dental Step 2 tools (B3)', () => {
  it('entering Step 2 starts on Paint; the four tools map to the canvas gesture', () => {
    expect(area).toMatchObject({ dentalStage: 'area', tool: 'paint' });
    expect(gesture(area)).toMatchObject({ kind: 'dental-area', brush: { kind: 'allow', radius: 2 }, edit: undefined });
    expect(gesture(run(area, { type: 'setTool', tool: 'erase' }))).toMatchObject({ kind: 'dental-area', brush: { kind: 'erase', radius: 2 } });
    const add = run(area, { type: 'setTool', tool: 'add' });
    expect(gesture(add)).toMatchObject({ kind: 'dental-area', brush: undefined, edit: { kind: 'add', remove: false } });
    expect(canvasGesture(gesture(add))).toEqual({ kind: 'add', remove: false });
    const select = run(area, { type: 'setTool', tool: 'select' }, { type: 'setSelectStyle', style: 'brush' });
    expect(canvasGesture(gesture(select))).toMatchObject({ kind: 'drag' });
    // Paint and Erase paint: the canvas keeps the area gesture.
    expect(canvasGesture(gesture(area)).kind).toBe('dental-area');
  });

  it('Add is forced to add in Step 2, even with Remove left on', () => {
    const remove = run(area, { type: 'setTool', tool: 'add' }, { type: 'setAddAction', action: 'remove' });
    expect(canvasGesture(gesture(remove))).toEqual({ kind: 'add', remove: false });
  });

  it('Step 2 selects tips; Step 3 always starts on Add, whatever Step 2 left on', () => {
    const picked = run(area, { type: 'setTool', tool: 'select' }, { type: 'toggleContact', id: 'a' });
    expect([...picked.selection]).toEqual(['a']);
    expect(run(area, { type: 'acceptDentalArea' })).toMatchObject({ dentalStage: 'review', tool: 'add', addAction: 'add' });
    expect(run(area, { type: 'setTool', tool: 'erase' }, { type: 'acceptDentalArea' })).toMatchObject({ tool: 'add', addAction: 'add' });
    expect(run(area, { type: 'setTool', tool: 'select' }, { type: 'acceptDentalArea' })).toMatchObject({ tool: 'add', addAction: 'add' });
    expect(run(area, { type: 'setTool', tool: 'add' }, { type: 'setAddAction', action: 'remove' }, { type: 'acceptDentalArea' })).toMatchObject({ tool: 'add', addAction: 'add' });
    // Back into Step 2 is a Paint start again.
    expect(run(area, { type: 'setTool', tool: 'select' }, { type: 'acceptDentalArea' }, { type: 'backDental' })).toMatchObject({ dentalStage: 'area', tool: 'paint' });
  });

  it('no other mode starts on Paint or Erase', () => {
    expect(run(area, { type: 'exit' }).tool).toBe('add');
    expect(run(area, { type: 'setTool', tool: 'select' }, { type: 'exit' }).tool).toBe('select');
  });

  it('the four tool commands are live only in Step 2 and pressed with their tool', () => {
    for (const [tool, id] of [['paint', 'dental.tool.paint'], ['erase', 'dental.tool.erase'], ['add', 'dental.tool.add'], ['select', 'dental.tool.select']] as const) {
      expect(COMMAND_IDS).toContain(id);
      expect(resolve(id, ui({ tool })).enabled).toBe(true);
      expect(resolve(id, ui({ tool })).pressed).toBe(true);
      expect(resolve(id, ui({ tool: tool === 'paint' ? 'erase' : 'paint' })).pressed).toBe(false);
      expect(resolve(id, ui({ dentalStage: 'review' })).visible).toBe(false);
      expect(resolve(id, ui({ dentalStage: 'review' })).enabled).toBe(false);
      expect(resolve(id, ui({ heavy: 1_600_000 })).enabled).toBe(false);
    }
  });

  it('P, E, A and S switch the tools in Step 2 only; Delete and Esc act on a selection there', () => {
    const press = (key: string, over: Partial<UiState> = {}, ctrl = false) => keyAction({ key, ctrl, shift: false, target: null, ui: ui(over) }).command;
    expect([press('p'), press('e'), press('a'), press('s')]).toEqual(['dental.tool.paint', 'dental.tool.erase', 'dental.tool.add', 'dental.tool.select']);
    expect(press('P')).toBe('dental.tool.paint');
    expect(press('p', {}, true)).toBeUndefined();
    expect(press('p', { dentalStage: 'review' })).toBeUndefined();
    expect(press('Delete', { selection: 2 })).toBe('edit.deleteSelection');
    expect(press('Backspace', { selection: 2 })).toBe('edit.deleteSelection');
    expect(press('Escape', { selection: 2 })).toBe('edit.clearSelection');
    expect(press('Escape', { selection: 0 })).toBe('dental.exit');
    expect(press('Delete', { selection: 0 })).toBeUndefined();
  });
});
