import type { AddAction, BrushMode, EditMode, EditTool, SelectStyle, StatusMessage } from './types';
import { busyStatus } from './status';

/**
 * The command registry: every control that has a name (a button, a key) is one row here, and the
 * components and the keyboard read it instead of deciding label, hint, visibility or enabled state
 * themselves (docs/design/ui-structure.md section 5). A typed descriptor table, no generic
 * renderer. Labels, hints and reasons are i18n keys; the host translates them where they show.
 */
export const COMMAND_IDS = [
  'history.undo', 'history.redo',
  'view.models', 'view.wireframe',
  'objects.delete',
  'transform.select', 'transform.move', 'transform.rotate',
  'supports.generate',
  'mode.edit', 'mode.zones', 'mode.exit',
  'edit.generate', 'edit.add', 'edit.remove', 'edit.dragSelect', 'edit.dragUnselect', 'edit.clearSelection', 'edit.deleteSelection',
  'setting.clickReach',
  'shape.reset', 'shape.selectCustomised',
] as const;
export type CommandId = (typeof COMMAND_IDS)[number];

/** `primary` is the red fill (one per view), `destructive` the danger outline; the button reads both. */
export type Role = 'primary' | 'secondary' | 'destructive';

/** What the registry's rules read, built by the host from its own state. */
export interface UiState {
  mode: EditMode;
  /** There is an active object. */
  active: boolean;
  /** Triangles of the active object when it is too heavy for hand edits. */
  heavy: number | undefined;
  /** Objects on the plate. */
  units: number;
  /** Objects selected in the left panel. */
  selectedObjects: number;
  /** Support Edit Mode's tool, and under Add whether a click adds or removes. */
  tool: EditTool;
  addAction: AddAction;
  /** Under Select: Click or Drag over. */
  method: SelectStyle;
  /** What Drag over does now: the Select | Unselect switch, flipped while Shift is held. */
  dragAction: BrushMode;
  /** Supports selected in Support Edit Mode. */
  selection: number;
  /** Supports of the active object with settings of their own, and how many of the selected ones. */
  customisedActive: number;
  customisedSelected: number;
  /** The active object has supports (generated or hand-added). */
  activeSupported: boolean;
  /** Undo and Redo as the host can run them now (Undo stops at the mode's floor). */
  canUndo: boolean;
  canRedo: boolean;
  modelsVisible: boolean;
  wireframe: boolean;
  /** Every object in scope has supports, so the one generate action reads Regenerate. */
  generated: boolean;
  /** A placement job is running: Generate waits for it. */
  generating: boolean;
}

interface Command {
  role: Role;
  /**
   * The key that runs it, as "Ctrl+Shift+Z" or "Esc": the one source of the key text in hints and
   * key caps. keys.ts binds it, and commands.test.ts checks the two agree.
   */
  shortcut?: string | ((s: UiState) => string | undefined);
  /** i18n keys, translated where shown; the shortcut is added to the hint. */
  label(s: UiState): string;
  hint(s: UiState): string;
  visible(s: UiState): boolean;
  enabled(s: UiState): boolean;
  /** Why the control is off; defined exactly when a visible command is not enabled. */
  disabledReason(s: UiState): StatusMessage | undefined;
  pressed?(s: UiState): boolean;
  /** The command a press runs, when it is another one: the exit buttons all run `mode.exit`. */
  runs?(s: UiState): CommandId;
}

const editable = (s: UiState) => s.active && s.heavy === undefined;
const always = () => true;
const never = () => undefined;
const heavyReason = (s: UiState): StatusMessage => ({ key: 'Too detailed to edit by hand ({n} triangles). Generate and export still use the full model.', vars: { n: (s.heavy ?? 0).toLocaleString() } });
/** Why a mode button is off: no object, a heavy one, or the other mode is on. */
const entryReason = (s: UiState): StatusMessage | undefined => {
  if (s.mode !== 'off') return busyStatus(s.mode);
  if (!s.active) return { key: 'Select an object first.' };
  return s.heavy === undefined ? undefined : heavyReason(s);
};
const inMode = (mode: EditMode) => (s: UiState) => s.mode === mode;
const generatingReason: StatusMessage = { key: 'Supports are being generated: wait for it to finish.' };

export const COMMANDS: Readonly<Record<CommandId, Command>> = {
  'history.undo': {
    role: 'secondary', shortcut: 'Ctrl+Z',
    label: () => 'Undo', hint: () => 'Undo',
    visible: always, enabled: (s) => s.canUndo,
    disabledReason: (s) => (s.canUndo ? undefined : { key: s.mode === 'off' ? 'Nothing to undo.' : 'Nothing to undo here: leave the mode to undo earlier steps.' }),
  },
  'history.redo': {
    role: 'secondary', shortcut: 'Ctrl+Shift+Z',
    label: () => 'Redo', hint: () => 'Redo',
    visible: always, enabled: (s) => s.canRedo,
    disabledReason: (s) => (s.canRedo ? undefined : { key: 'Nothing to redo.' }),
  },
  'view.models': {
    role: 'secondary',
    label: (s) => (s.modelsVisible ? 'Hide models' : 'Show models'),
    hint: (s) => (s.modelsVisible ? 'Hide the models to see the supports alone. Export is not affected' : 'Show the models again'),
    visible: always, enabled: always, disabledReason: never,
  },
  'view.wireframe': {
    role: 'secondary',
    label: (s) => (s.wireframe ? 'Solid' : 'Wireframe'),
    hint: (s) => (s.wireframe ? 'Draw the models solid' : 'Draw the models as wireframes to see supports behind them'),
    visible: always, enabled: always, disabledReason: never,
  },
  'objects.delete': {
    role: 'destructive', shortcut: 'Delete',
    label: () => 'Delete', hint: () => 'Delete the selected objects. Undo brings them back',
    visible: always, enabled: (s) => s.selectedObjects > 0,
    disabledReason: (s) => (s.selectedObjects > 0 ? undefined : { key: 'Select an object first.' }),
  },
  'transform.select': transformChoice('Select', 'Select objects without a gizmo'),
  'transform.move': transformChoice('Move', 'Move the active object with the gizmo', 'G'),
  'transform.rotate': transformChoice('Rotate', 'Rotate the active object with the gizmo', 'R'),
  'supports.generate': {
    role: 'primary',
    label: (s) => (s.generating ? 'Generating supports…' : s.generated ? 'Regenerate' : 'Generate supports'),
    hint: (s) => (s.generated
      ? 'Replaces the automatic supports. Supports you added are kept, and so are removals where they still fit'
      : 'Place automatic supports on the selected objects, or on every object when none is selected'),
    visible: always, enabled: (s) => s.units > 0 && !s.generating,
    disabledReason: (s) => (s.units === 0 ? { key: 'Import a model before generating supports.' } : s.generating ? generatingReason : undefined),
  },
  'mode.edit': {
    role: 'secondary',
    shortcut: (s) => (s.mode === 'edit' ? 'Esc' : undefined),
    label: (s) => (s.mode === 'edit' ? 'Exit Support Edit Mode' : 'Edit supports'),
    hint: (s) => (s.mode === 'edit' ? 'Finish editing supports' : 'Add or remove supports by clicking'),
    visible: always,
    // Inside Support Edit Mode the button is its exit, in the same place.
    enabled: (s) => (s.mode === 'edit' ? true : s.mode === 'off' && editable(s)),
    disabledReason: (s) => (s.mode === 'edit' || (s.mode === 'off' && editable(s)) ? undefined : entryReason(s)),
    pressed: inMode('edit'),
    runs: (s) => (s.mode === 'edit' ? 'mode.exit' : 'mode.edit'),
  },
  'mode.zones': {
    role: 'secondary',
    shortcut: (s) => (s.mode === 'zones' ? 'Esc' : undefined),
    label: (s) => (s.mode === 'zones' ? 'Exit no-support zones' : 'No-support zones'),
    hint: (s) => (s.mode === 'zones' ? 'Finish painting zones' : 'Paint areas of the model where automatic supports must not grow'),
    visible: always,
    enabled: (s) => (s.mode === 'zones' ? true : s.mode === 'off' && editable(s)),
    disabledReason: (s) => (s.mode === 'zones' || (s.mode === 'off' && editable(s)) ? undefined : entryReason(s)),
    pressed: inMode('zones'),
    runs: (s) => (s.mode === 'zones' ? 'mode.exit' : 'mode.zones'),
  },
  /** The one exit of both modes: the Done button of each bar, both left Exit buttons, Esc and Enter. */
  'mode.exit': {
    role: 'primary', shortcut: 'Esc',
    label: () => 'Done',
    hint: (s) => (s.mode === 'zones' ? 'Finish painting zones' : 'Finish editing supports'),
    visible: (s) => s.mode !== 'off', enabled: always, disabledReason: never,
  },
  'edit.generate': {
    role: 'secondary',
    label: (s) => (s.generating ? 'Generating supports…' : 'Generate supports'),
    hint: () => 'Place automatic supports on this object without leaving the mode',
    visible: (s) => s.mode === 'edit' && !s.activeSupported, enabled: (s) => !s.generating,
    disabledReason: (s) => (s.generating ? generatingReason : undefined),
  },
  'edit.add': addChoice('add', 'Add', 'Each click adds a support on the model'),
  'edit.remove': addChoice('remove', 'Remove', 'Each click removes the support it hits, or the one nearest a click on the model within Click reach. Right-click does the same'),
  'edit.dragSelect': dragChoice('select', 'Select', 'Dragging adds supports to the selection'),
  'edit.dragUnselect': dragChoice('unselect', 'Unselect', 'Dragging takes supports out of the selection'),
  /** A number field, set through its input: the Add bar and the right panel's Advanced render this one row. */
  'setting.clickReach': {
    role: 'secondary',
    label: () => 'Click reach',
    hint: () => 'How far from a support a click may land and still pick it. Only that one support is removed',
    visible: always, enabled: (s) => s.active,
    disabledReason: (s) => (s.active ? undefined : { key: 'Select an object first.' }),
  },
  /** Support shape region: the selection follows the defaults again. */
  'shape.reset': {
    role: 'secondary',
    label: () => 'Reset to defaults',
    hint: () => 'Give the selected supports the default settings again. Undo brings their own values back',
    visible: (s) => s.mode === 'edit' && s.selection > 0, enabled: (s) => s.customisedSelected > 0,
    disabledReason: (s) => (s.customisedSelected > 0 ? undefined : { key: 'None of the selected supports has settings of its own.' }),
  },
  /** The header count's action: outside Support Edit Mode it enters the mode with those supports selected. */
  'shape.selectCustomised': {
    role: 'secondary',
    label: () => 'Select them',
    hint: (s) => (s.mode === 'edit' ? 'Select the supports of this object that have settings of their own' : 'Enter Support Edit Mode with the supports that have settings of their own selected'),
    visible: (s) => s.customisedActive > 0, enabled: (s) => s.active && (s.mode === 'edit' || (s.mode === 'off' && s.heavy === undefined)),
    disabledReason: (s) => (s.mode === 'zones' ? busyStatus(s.mode) : !s.active ? { key: 'Select an object first.' } : s.mode === 'off' && s.heavy !== undefined ? heavyReason(s) : undefined),
  },
  'edit.clearSelection': {
    role: 'secondary', shortcut: 'Esc',
    label: () => 'Clear selection', hint: () => 'Unselect every support at once. Undo on the notice brings the selection back',
    visible: (s) => s.mode === 'edit' && s.selection > 0, enabled: always, disabledReason: never,
  },
  'edit.deleteSelection': {
    role: 'destructive', shortcut: 'Delete',
    label: () => 'Delete', hint: () => 'Delete the selected supports. Undo brings them back',
    visible: (s) => s.mode === 'edit' && s.selection > 0, enabled: always, disabledReason: never,
  },
};

/** The Add | Remove switch under the Add tool. */
function addChoice(action: AddAction, label: string, hint: string): Command {
  return {
    role: 'secondary', label: () => label, hint: () => hint,
    visible: (s) => s.mode === 'edit' && s.tool === 'add', enabled: always, disabledReason: never,
    pressed: (s) => s.addAction === action,
  };
}

/** The Select | Unselect switch under Drag over; it shows what a stroke does now, Shift included. */
function dragChoice(action: BrushMode, label: string, hint: string): Command {
  return {
    role: 'secondary', label: () => label, hint: () => hint,
    visible: (s) => s.mode === 'edit' && s.tool === 'select' && s.method === 'brush', enabled: always, disabledReason: never,
    pressed: (s) => s.dragAction === action,
  };
}

/** The gizmo choices of the Transform group: live outside the modes, with an object to move. */
function transformChoice(label: string, hint: string, shortcut?: string): Command {
  return {
    role: 'secondary', ...(shortcut ? { shortcut } : {}),
    label: () => label, hint: () => hint,
    visible: always, enabled: (s) => s.mode === 'off' && s.active,
    disabledReason: (s) => (s.mode !== 'off' ? busyStatus(s.mode) : s.active ? undefined : { key: 'Select an object first.' }),
  };
}

/** A command as it stands in one state: what a control shows and does. */
export interface ResolvedCommand {
  id: CommandId;
  role: Role;
  shortcut: string | undefined;
  label: string;
  hint: string;
  visible: boolean;
  enabled: boolean;
  disabledReason: StatusMessage | undefined;
  /** Defined for a two-state button (the mode buttons): its aria-pressed. */
  pressed: boolean | undefined;
  /** The command a press runs (the id itself, or `mode.exit` for an exit button). */
  runs: CommandId;
}

export function resolve(id: CommandId, state: UiState): ResolvedCommand {
  const command = COMMANDS[id];
  const { shortcut } = command;
  return {
    id, role: command.role, shortcut: typeof shortcut === 'function' ? shortcut(state) : shortcut,
    label: command.label(state), hint: command.hint(state),
    visible: command.visible(state), enabled: command.enabled(state), disabledReason: command.disabledReason(state),
    pressed: command.pressed?.(state),
    runs: command.runs?.(state) ?? id,
  };
}
