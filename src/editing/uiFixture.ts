import type { UiState } from './commands';
import type { EditMode } from './types';

/** A state with an active, supported object selected and nothing running: the base the tests vary. */
export const READY: UiState = {
  mode: 'off', active: true, heavy: undefined, units: 1, selectedObjects: 1, tool: 'add', addAction: 'add', method: 'click', dragAction: 'select', selection: 0, customisedActive: 0, customisedSelected: 0, customisedTargeted: 0, customisedOthers: 0, activeSupported: true,
  canUndo: true, canRedo: true, modelsVisible: true, wireframe: false, generated: false, generating: false,
};

const at = (change: Partial<UiState>): UiState => ({ ...READY, ...change });
const MODES: EditMode[] = ['off', 'edit', 'zones'];
const BOOLS = [true, false];
/** Every combination of the facts the registry's rules read, small enough to walk whole. */
export const STATES: UiState[] = MODES.flatMap((mode) => BOOLS.flatMap((active) => [undefined, 1_600_000].flatMap((heavy) =>
  [0, 3].flatMap((selection) => BOOLS.flatMap((canUndo) => BOOLS.flatMap((hasUnits) => BOOLS.flatMap((generated) => BOOLS.map((generating) => at({
    mode, active, heavy, selection, canUndo, canRedo: !canUndo, units: hasUnits ? 2 : 0, selectedObjects: hasUnits ? 1 : 0,
    generated, generating, customisedActive: generated ? 2 : 0, customisedTargeted: generated ? 2 : 0, customisedSelected: selection > 0 && canUndo ? 1 : 0, activeSupported: generated, tool: canUndo ? 'add' : 'select', addAction: generated ? 'remove' : 'add', method: generated ? 'brush' : 'click', dragAction: canUndo ? 'select' : 'unselect', modelsVisible: canUndo, wireframe: generated,
  })))))))));
