import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, COMMANDS, resolve, type CommandId, type UiState } from './commands';
import { keyAction, type KeyInput } from './keys';
import type { EditMode } from './types';
import { READY, STATES } from './uiFixture';

const at = (change: Partial<UiState>): UiState => ({ ...READY, ...change });

const MODES: EditMode[] = ['off', 'edit', 'zones'];
const BOOLS = [true, false];

/** "Ctrl+Shift+Z" as the key event that types it. */
function pressOf(shortcut: string): Pick<KeyInput, 'key' | 'ctrl' | 'shift'> {
  const parts = shortcut.split('+');
  const name = parts[parts.length - 1]!;
  return { key: name === 'Esc' ? 'Escape' : name.length === 1 ? name.toLowerCase() : name, ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift') };
}

describe('the registry and the keyboard', () => {
  const KEYS = ['z', 'Z', 'y', 'Y', 'g', 'G', 'r', 'R', 'Delete', 'Backspace', 'Escape', 'Enter', 'Tab', 'x'];
  const PRESSES = STATES.flatMap((ui) => KEYS.flatMap((key) => BOOLS.flatMap((ctrl) => BOOLS.map((shift) =>
    keyAction({ key, ctrl, shift, target: null, ui })))));

  it('maps every key binding to a registry command', () => {
    const bound = new Set(PRESSES.flatMap((action) => (action.command ? [action.command] : [])));
    expect(bound.size).toBeGreaterThan(0);
    for (const command of bound) expect(COMMAND_IDS).toContain(command);
  });

  it('binds each advertised shortcut to that exact command, in every state that shows it live', () => {
    let checked = 0;
    for (const id of COMMAND_IDS) {
      for (const ui of STATES) {
        const command = resolve(id, ui);
        // The Delete button of the Objects group is shown in every mode; its key works outside them.
        if (!command.shortcut || !command.visible || !command.enabled || (id === 'objects.delete' && ui.mode !== 'off')) continue;
        // Esc with supports selected clears the selection first: the Exit controls run when the mode is next.
        const expected = command.runs === 'mode.exit' && ui.mode === 'edit' && ui.selection > 0 ? 'edit.clearSelection' : command.runs;
        expect(keyAction({ ...pressOf(command.shortcut), target: null, ui }).command, `${id} in ${ui.mode}`).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('does not advertise a key a command does not run on', () => {
    for (const ui of STATES) {
      for (const id of COMMAND_IDS) {
        const { shortcut, visible, enabled } = resolve(id, ui);
        if (shortcut && visible && !enabled) {
          const action = keyAction({ ...pressOf(shortcut), target: null, ui });
          expect(action.command, `${id} is off in ${ui.mode}`).not.toBe(id);
        }
      }
    }
  });

  it('never takes Tab', () => {
    for (const ui of STATES) {
      expect(keyAction({ key: 'Tab', ctrl: false, shift: false, target: null, ui })).toEqual({ command: undefined, preventDefault: false });
    }
  });

  it('runs no command that is off in the state of the press', () => {
    for (const ui of STATES) {
      for (const key of KEYS) {
        const { command } = keyAction({ key, ctrl: true, shift: false, target: null, ui });
        if (command) expect(resolve(command, ui).enabled, `${key} in ${ui.mode}`).toBe(true);
      }
    }
  });
});

describe('the registry shows each control once', () => {
  it('keeps one row per id', () => {
    expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length);
    expect(Object.keys(COMMANDS).sort()).toEqual([...COMMAND_IDS].sort());
  });

  it('says why a shown control is off, and only then', () => {
    for (const state of STATES) {
      for (const id of COMMAND_IDS) {
        const command = resolve(id, state);
        if (!command.visible) continue;
        expect(command.disabledReason !== undefined, `${id} in ${state.mode}`).toBe(!command.enabled);
      }
    }
  });

  it('keeps key text out of the hints: it comes from the shortcut field', () => {
    for (const state of STATES) {
      for (const id of COMMAND_IDS) expect(resolve(id, state).hint, id).not.toMatch(/\((Esc|G|R|Delete|Ctrl|Enter)/);
    }
  });
});

describe('one exit', () => {
  it('every exit control runs mode.exit while its mode is on', () => {
    const edit = at({ mode: 'edit' });
    const zones = at({ mode: 'zones' });
    expect(resolve('mode.edit', edit).runs).toBe('mode.exit');
    expect(resolve('mode.zones', zones).runs).toBe('mode.exit');
    expect(resolve('mode.exit', edit)).toMatchObject({ label: 'Done', role: 'primary', runs: 'mode.exit', visible: true });
    expect(resolve('mode.exit', zones)).toMatchObject({ label: 'Done', visible: true });
    expect(resolve('mode.exit', READY).visible).toBe(false);
  });

  it('the entry buttons run themselves outside the modes', () => {
    expect(resolve('mode.edit', READY).runs).toBe('mode.edit');
    expect(resolve('mode.zones', READY).runs).toBe('mode.zones');
  });

  it('the edit bar offers Generate until the object has supports', () => {
    expect(resolve('edit.generate', at({ mode: 'edit', activeSupported: false })).visible).toBe(true);
    expect(resolve('edit.generate', at({ mode: 'edit' })).visible).toBe(false);
    expect(resolve('edit.generate', at({ mode: 'zones', activeSupported: false })).visible).toBe(false);
    expect(resolve('edit.generate', at({ mode: 'edit', activeSupported: false, generating: true }))).toMatchObject({ enabled: false, label: 'Generating supports…' });
  });

  it('the selection actions come with a selection', () => {
    expect(resolve('edit.clearSelection', at({ mode: 'edit', selection: 2 })).visible).toBe(true);
    expect(resolve('edit.deleteSelection', at({ mode: 'edit', selection: 2 })).visible).toBe(true);
    expect(resolve('edit.deleteSelection', at({ mode: 'edit' }))).toMatchObject({ visible: true, enabled: false, disabledReason: { key: 'Select a support first.' } });
    expect(resolve('zones.clearAll', at({ mode: 'zones', zones: 0 }))).toMatchObject({ enabled: false, disabledReason: { key: 'No zones are painted yet.' } });
    expect(resolve('zones.clearAll', at({ mode: 'zones', zones: 2 })).enabled).toBe(true);
  });
});

describe('the mode buttons: the entry button becomes the exit button', () => {
  it('outside the modes both enter, unpressed', () => {
    expect(resolve('mode.edit', READY)).toMatchObject({ label: 'Edit supports', pressed: false, enabled: true, shortcut: undefined });
    expect(resolve('mode.zones', READY)).toMatchObject({ label: 'No-support zones', pressed: false, enabled: true });
  });

  it('other commands are not two-state', () => {
    expect(resolve('supports.generate', READY).pressed).toBeUndefined();
  });

  it('in Support Edit Mode its button reads Exit, pressed, live; zones waits', () => {
    const edit = at({ mode: 'edit' });
    expect(resolve('mode.edit', edit)).toMatchObject({ label: 'Exit Support Edit Mode', hint: 'Finish editing supports', shortcut: 'Esc', pressed: true, enabled: true });
    expect(resolve('mode.zones', edit)).toMatchObject({ label: 'No-support zones', pressed: false, enabled: false, disabledReason: { key: 'Finish editing supports first: press Esc or Done.' } });
  });

  it('in zones mode its button reads Exit, pressed, live; Edit Mode waits', () => {
    const zones = at({ mode: 'zones' });
    expect(resolve('mode.zones', zones)).toMatchObject({ label: 'Exit no-support zones', pressed: true, enabled: true });
    expect(resolve('mode.edit', zones)).toMatchObject({ label: 'Edit supports', enabled: false, disabledReason: { key: 'Finish painting zones first: press Esc or Done.' } });
  });

  it('neither opens without an object, and a heavy object says why', () => {
    const none = at({ active: false });
    expect(resolve('mode.edit', none)).toMatchObject({ enabled: false, disabledReason: { key: 'Select an object first.' } });
    expect(resolve('mode.zones', none).enabled).toBe(false);
    const heavy = at({ heavy: 1_600_000 });
    expect(resolve('mode.edit', heavy)).toMatchObject({ enabled: false, disabledReason: { vars: { n: (1_600_000).toLocaleString() } } });
  });
});

describe('the header in a mode', () => {
  it('keeps the view toggles live in every mode', () => {
    for (const state of STATES) {
      expect(resolve('view.models', state).enabled).toBe(true);
      expect(resolve('view.wireframe', state).enabled).toBe(true);
    }
  });

  it('keeps Undo and Redo live down to the floor the host reports, in a mode too', () => {
    for (const mode of MODES) {
      expect(resolve('history.undo', at({ mode, canUndo: true })).enabled).toBe(true);
      expect(resolve('history.undo', at({ mode, canUndo: false })).enabled).toBe(false);
      expect(resolve('history.redo', at({ mode, canRedo: true })).enabled).toBe(true);
    }
    expect(resolve('history.undo', at({ mode: 'edit', canUndo: false })).disabledReason?.key).toBe('Nothing to undo here: leave the mode to undo earlier steps.');
  });

  it('Save project needs an object, and Open project waits for the mode to be finished', () => {
    expect(resolve('project.save', at({ units: 0 })).disabledReason?.key).toBe('Import a model first.');
    expect(resolve('project.save', at({ units: 1 })).enabled).toBe(true);
    expect(resolve('project.open', at({ mode: 'off', units: 0 })).enabled).toBe(true);
    expect(resolve('project.open', at({ mode: 'edit' })).disabledReason?.key).toBe('Finish editing supports first: press Esc or Done.');
    expect(resolve('project.open', at({ mode: 'zones' })).disabledReason?.key).toBe('Finish painting zones first: press Esc or Done.');
    expect(resolve('history.undo', at({ undoStep: 'openProject' })).hint).toBe('Undo opening the project');
  });

  it('Undo and Redo name the step they take back or bring back', () => {
    expect(resolve('history.undo', at({ undoStep: 'addSupport' })).hint).toBe('Undo adding a support');
    expect(resolve('history.redo', at({ redoStep: 'zones' })).hint).toBe('Redo the zone change');
    expect(resolve('history.undo', at({ undoStep: undefined })).hint).toBe('Undo');
  });

  it('flips the toggle labels with the view', () => {
    expect(resolve('view.models', at({ modelsVisible: false })).label).toBe('Show models');
    expect(resolve('view.wireframe', at({ wireframe: true })).label).toBe('Solid');
  });
});

describe('the left panel commands', () => {
  it('Transform waits in a mode, with the mode named, and needs an object', () => {
    for (const id of ['transform.select', 'transform.move', 'transform.rotate'] as CommandId[]) {
      expect(resolve(id, READY).enabled).toBe(true);
      expect(resolve(id, at({ mode: 'edit' }))).toMatchObject({ enabled: false, disabledReason: { key: 'Finish editing supports first: press Esc or Done.' } });
      expect(resolve(id, at({ active: false }))).toMatchObject({ enabled: false, disabledReason: { key: 'Select an object first.' } });
    }
  });

  it('Generate reads Regenerate once everything has supports, and needs a model', () => {
    expect(resolve('supports.generate', READY).label).toBe('Generate supports');
    expect(resolve('supports.generate', at({ generated: true })).label).toBe('Regenerate');
    expect(resolve('supports.generate', at({ units: 0 }))).toMatchObject({ enabled: false, disabledReason: { key: 'Import a model before generating supports.' } });
  });

  it('Generate is busy while a placement runs, so a second press cannot start another', () => {
    expect(resolve('supports.generate', at({ generating: true }))).toMatchObject({ enabled: false, label: 'Generating supports…', disabledReason: { key: 'Supports are being generated: wait for it to finish.' } });
    expect(resolve('supports.generate', at({ generating: true, generated: true })).label).toBe('Generating supports…');
  });

  it('keeps Dental generation inside the dental workflow and blocks a duplicate placement', () => {
    expect(resolve('dental.generate', at({ mode: 'dental' }))).toMatchObject({ visible: true, enabled: true, role: 'primary' });
    expect(resolve('dental.generate', at({ mode: 'dental', generating: true }))).toMatchObject({ enabled: false, label: 'Generating dental supports…', disabledReason: { key: 'Supports are being generated: wait for it to finish.' } });
    expect(resolve('dental.generate', READY).visible).toBe(false);
  });

  it('Delete objects needs a selected object', () => {
    expect(resolve('objects.delete', at({ selectedObjects: 0 })).enabled).toBe(false);
    expect(resolve('objects.delete', READY).enabled).toBe(true);
    expect(resolve('objects.delete', READY).role).toBe('destructive');
  });
});

describe('the Add | Remove switch and Click reach', () => {
  it('the switch shows under the Add tool only, and presses the chosen action', () => {
    expect(resolve('edit.add', at({ mode: 'edit', tool: 'add', addAction: 'add' }))).toMatchObject({ visible: true, pressed: true });
    expect(resolve('edit.remove', at({ mode: 'edit', tool: 'add', addAction: 'add' }))).toMatchObject({ visible: true, pressed: false });
    expect(resolve('edit.remove', at({ mode: 'edit', tool: 'add', addAction: 'remove' })).pressed).toBe(true);
    for (const change of [{ mode: 'edit', tool: 'select' }, { mode: 'off' }, { mode: 'zones' }] as const) expect(resolve('edit.remove', at(change)).visible).toBe(false);
  });

  it('Click reach is one row for both places that show it, and needs an object', () => {
    expect(resolve('setting.clickReach', READY)).toMatchObject({ label: 'Click reach', enabled: true });
    expect(resolve('setting.clickReach', at({ active: false }))).toMatchObject({ enabled: false, disabledReason: { key: 'Select an object first.' } });
  });
});

describe('the Select | Unselect switch', () => {
  const drag = { mode: 'edit', tool: 'select', method: 'brush' } as const;
  it('shows only under Drag over', () => {
    expect(resolve('edit.dragSelect', at({ ...drag })).visible).toBe(true);
    for (const off of [{ method: 'click' }, { tool: 'add' }, { mode: 'off' }, { mode: 'zones' }] as const) {
      expect(resolve('edit.dragUnselect', at({ ...drag, ...off })).visible, JSON.stringify(off)).toBe(false);
    }
  });
  it('presses the action a drag does now, so Shift moves the press', () => {
    expect(resolve('edit.dragSelect', at({ ...drag, dragAction: 'select' })).pressed).toBe(true);
    expect(resolve('edit.dragUnselect', at({ ...drag, dragAction: 'select' })).pressed).toBe(false);
    expect(resolve('edit.dragUnselect', at({ ...drag, dragAction: 'unselect' }))).toMatchObject({ pressed: true, label: 'Unselect', hint: 'Dragging takes supports out of the selection' });
  });
});

describe('Select them', () => {
  it('shows whenever a targeted object has customised supports, not only the active one', () => {
    expect(resolve('shape.selectCustomised', at({ customisedTargeted: 0 })).visible).toBe(false);
    expect(resolve('shape.selectCustomised', at({ customisedActive: 0, customisedTargeted: 3, customisedOthers: 3 })).visible).toBe(true);
  });

  it('selects on the active object and says how many sit on the other objects', () => {
    const both = resolve('shape.selectCustomised', at({ customisedActive: 2, customisedTargeted: 5, customisedOthers: 3 }));
    expect(both.enabled).toBe(true);
    expect(both.hintVars).toEqual({ n: 3 });
    expect(resolve('shape.selectCustomised', at({ customisedActive: 2, customisedTargeted: 2 })).hintVars).toBeUndefined();
  });

  it('works from another object when the active one has none, and names the first one in the hint', () => {
    const onlyOthers = resolve('shape.selectCustomised', at({ customisedActive: 0, customisedTargeted: 3, customisedOthers: 3 }));
    expect(onlyOthers.enabled).toBe(true);
    expect(onlyOthers.disabledReason).toBeUndefined();
    expect(onlyOthers.hint).toMatch(/first selected object/);
    expect(onlyOthers.hintVars).toBeUndefined();
  });

  it('stays off while a zone brush runs, and when no object is active', () => {
    expect(resolve('shape.selectCustomised', at({ mode: 'zones', customisedActive: 0, customisedTargeted: 3, customisedOthers: 3 })).enabled).toBe(false);
    expect(resolve('shape.selectCustomised', at({ active: false, customisedActive: 0, customisedTargeted: 3, customisedOthers: 3 })).disabledReason).toBeDefined();
  });

  it('is not held back by a heavy active object that has none of its own', () => {
    expect(resolve('shape.selectCustomised', at({ heavy: 3_000_000, customisedActive: 0, customisedTargeted: 3, customisedOthers: 3 })).enabled).toBe(true);
    expect(resolve('shape.selectCustomised', at({ heavy: 3_000_000, customisedActive: 2, customisedTargeted: 2 })).enabled).toBe(false);
  });
});
