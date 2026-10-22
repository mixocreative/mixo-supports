import type { UiState } from './commands';
import type { EditMode } from './types';

/** A state with an active, supported object selected and nothing running: the base the tests vary. */
export const READY: UiState = {
  mode: 'off', active: true, heavy: undefined, units: 1, selectedObjects: 1, selection: 0, activeSupported: true,
  canUndo: true, canRedo: true, modelsVisible: true, wireframe: false, generated: false, generating: false,
};

const at = (change: Partial<UiState>): UiState => ({ ...READY, ...change });
const MODES: EditMode[] = ['off', 'edit', 'zones'];
const BOOLS = [true, false];
/** Every combination of the facts the registry's rules read, small enough to walk whole. */
export const STATES: UiState[] = MODES.flatMap((mode) => BOOLS.flatMap((active) => [undefined, 1_600_000].flatMap((heavy) =>
  [0, 3].flatMap((selection) => BOOLS.flatMap((canUndo) => BOOLS.flatMap((hasUnits) => BOOLS.flatMap((generated) => BOOLS.map((generating) => at({
    mode, active, heavy, selection, canUndo, canRedo: !canUndo, units: hasUnits ? 2 : 0, selectedObjects: hasUnits ? 1 : 0,
    generated, generating, activeSupported: generated, modelsVisible: canUndo, wireframe: generated,
  })))))))));
