import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, COMMANDS, resolve, visibleIn, type CommandId, type Region, type UiState } from './commands';
import { keyAction } from './keys';
import type { EditMode } from './types';

const base: UiState = {
  mode: 'off', active: true, heavy: undefined, units: 1, selectedObjects: 1, selection: 0,
  canUndo: true, canRedo: true, modelsVisible: true, wireframe: false, generated: false,
};
const at = (change: Partial<UiState>): UiState => ({ ...base, ...change });

const MODES: EditMode[] = ['off', 'edit', 'zones'];
const BOOLS = [true, false];
/** Every combination of the facts the rules read, small enough to walk whole. */
const STATES: UiState[] = MODES.flatMap((mode) => BOOLS.flatMap((active) => [undefined, 1_600_000].flatMap((heavy) =>
  [0, 3].flatMap((selection) => BOOLS.flatMap((canUndo) => BOOLS.flatMap((hasUnits) => BOOLS.map((generated) => at({
    mode, active, heavy, selection, canUndo, canRedo: !canUndo, units: hasUnits ? 2 : 0, selectedObjects: hasUnits ? 1 : 0,
    generated, modelsVisible: canUndo, wireframe: generated,
  }))))))));

describe('the registry and the keyboard', () => {
  const KEYS = ['z', 'Z', 'y', 'Y', 'g', 'G', 'r', 'R', 'Delete', 'Backspace', 'Escape', 'Enter', 'Tab', 'x'];
  const PRESSES = KEYS.flatMap((key) => MODES.flatMap((mode) => BOOLS.flatMap((hasSelection) => BOOLS.flatMap((ctrl) => BOOLS.map((shift) =>
    keyAction({ key, ctrl, shift, target: null, mode, hasSelection }))))));
  const bound = new Set(PRESSES.flatMap((action) => (action.command ? [action.command] : [])));

  it('maps every key binding to a registry command', () => {
    expect(bound.size).toBeGreaterThan(0);
    for (const command of bound) expect(COMMAND_IDS).toContain(command);
  });

  it('binds every command that advertises a shortcut', () => {
    const advertised = COMMAND_IDS.filter((id) => COMMANDS[id].shortcut);
    expect(advertised.length).toBeGreaterThan(0);
    for (const id of advertised) {
      const runs = STATES.map((state) => resolve(id, state).runs);
      expect(runs.some((target) => bound.has(target)), `${id} runs ${runs[0]}`).toBe(true);
    }
  });

  it('never takes Tab', () => {
    for (const mode of MODES) {
      for (const hasSelection of BOOLS) {
        expect(keyAction({ key: 'Tab', ctrl: false, shift: false, target: null, mode, hasSelection })).toEqual({ command: undefined, preventDefault: false });
      }
    }
  });
});

describe('the registry shows each control once', () => {
  const REGIONS: Region[] = ['header', 'left', 'viewport', 'editBar', 'zonesBar', 'keyboard'];

  it('keeps one row per id', () => {
    expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length);
    expect(Object.keys(COMMANDS).sort()).toEqual([...COMMAND_IDS].sort());
  });

  it('shows no id twice, and no two controls with one label, in a region in any state', () => {
    for (const state of STATES) {
      for (const region of REGIONS) {
        const shown = visibleIn(region, state);
        expect(new Set(shown.map((command) => command.id)).size).toBe(shown.length);
        const labels = shown.flatMap((command) => (command.label ? [command.label] : []));
        expect(new Set(labels).size, `${region}: ${labels.join(', ')}`).toBe(labels.length);
      }
    }
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
});

describe('one exit', () => {
  it('every exit control runs mode.exit while its mode is on', () => {
    const edit = at({ mode: 'edit' });
    const zones = at({ mode: 'zones' });
    expect(resolve('mode.edit', edit).runs).toBe('mode.exit');
    expect(resolve('edit.done', edit).runs).toBe('mode.exit');
    expect(resolve('mode.zones', zones).runs).toBe('mode.exit');
    expect(resolve('zones.done', zones).runs).toBe('mode.exit');
    expect(visibleIn('keyboard', edit).map((command) => command.id)).toEqual(['mode.exit']);
  });

  it('the entry buttons run themselves outside the modes', () => {
    expect(resolve('mode.edit', base).runs).toBe('mode.edit');
    expect(resolve('mode.zones', base).runs).toBe('mode.zones');
    expect(resolve('vp.editToggle', base).runs).toBe('mode.edit');
  });

  it('Done shows in its own mode only', () => {
    expect(visibleIn('editBar', at({ mode: 'edit' })).map((command) => command.id)).toEqual(['edit.done']);
    expect(visibleIn('zonesBar', at({ mode: 'zones' })).map((command) => command.id)).toEqual(['zones.done']);
    expect(visibleIn('editBar', at({ mode: 'zones' }))).toEqual([]);
    expect(visibleIn('editBar', base)).toEqual([]);
  });

  it('the selection actions come with a selection', () => {
    expect(visibleIn('editBar', at({ mode: 'edit', selection: 2 })).map((command) => command.id)).toEqual(['edit.clearSelection', 'edit.deleteSelection', 'edit.done']);
  });
});

describe('the mode buttons: the entry button becomes the exit button', () => {
  it('outside the modes both enter, unpressed', () => {
    expect(resolve('mode.edit', base)).toMatchObject({ label: 'Enter Support Edit Mode', pressed: false, enabled: true });
    expect(resolve('mode.zones', base)).toMatchObject({ label: 'Paint zones', pressed: false, enabled: true });
  });

  it('in Support Edit Mode its button reads Exit, pressed, live; zones waits', () => {
    const edit = at({ mode: 'edit' });
    expect(resolve('mode.edit', edit)).toMatchObject({ label: 'Exit Support Edit Mode', hint: 'Finish editing supports (Esc)', pressed: true, enabled: true });
    expect(resolve('mode.zones', edit)).toMatchObject({ label: 'Paint zones', pressed: false, enabled: false, disabledReason: { key: 'Finish editing supports first: press Esc or Done.' } });
  });

  it('in zones mode its button reads Exit, pressed, live; Edit Mode waits', () => {
    const zones = at({ mode: 'zones' });
    expect(resolve('mode.zones', zones)).toMatchObject({ label: 'Exit no-support zones', pressed: true, enabled: true });
    expect(resolve('mode.edit', zones)).toMatchObject({ label: 'Enter Support Edit Mode', enabled: false, disabledReason: { key: 'Finish painting zones first: press Esc or Done.' } });
  });

  it('neither opens without an object, and a heavy object says why', () => {
    const none = at({ active: false });
    expect(resolve('mode.edit', none)).toMatchObject({ enabled: false, disabledReason: { key: 'Select an object first.' } });
    expect(resolve('mode.zones', none).enabled).toBe(false);
    const heavy = at({ heavy: 1_600_000 });
    expect(resolve('mode.edit', heavy)).toMatchObject({ enabled: false, disabledReason: { vars: { n: (1_600_000).toLocaleString() } } });
    expect(resolve('vp.editToggle', heavy).enabled).toBe(false);
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

  it('flips the toggle labels with the view', () => {
    expect(resolve('view.models', at({ modelsVisible: false })).label).toBe('Show models');
    expect(resolve('view.wireframe', at({ wireframe: true })).label).toBe('Solid');
  });
});

describe('the left panel commands', () => {
  it('Transform waits in a mode, with the mode named', () => {
    for (const id of ['transform.select', 'transform.move', 'transform.rotate'] as CommandId[]) {
      expect(resolve(id, base).enabled).toBe(true);
      expect(resolve(id, at({ mode: 'edit' }))).toMatchObject({ enabled: false, disabledReason: { key: 'Finish editing supports first: press Esc or Done.' } });
    }
  });

  it('Generate reads Regenerate once everything has supports, and needs a model', () => {
    expect(resolve('supports.generate', base).label).toBe('Generate supports');
    expect(resolve('supports.generate', at({ generated: true })).label).toBe('Regenerate');
    expect(resolve('supports.generate', at({ units: 0 }))).toMatchObject({ enabled: false, disabledReason: { key: 'Import a model before generating supports.' } });
  });

  it('Delete objects needs a selected object', () => {
    expect(resolve('objects.delete', at({ selectedObjects: 0 })).enabled).toBe(false);
    expect(resolve('objects.delete', base).enabled).toBe(true);
  });
});
