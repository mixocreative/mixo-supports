import { resolve, type CommandId, type UiState } from '../editing/commands';
import { t, translateMessage } from '../i18n';
import { CommandButton } from './CommandButton';

/**
 * The left panel's Modes group: Support Edit Mode and No-support zones, each button turning into
 * its mode's exit while the mode is on (the registry's mode.edit and mode.zones rows). The panel
 * lock leaves the active mode's button live and makes the other one inert. `zones`: the active
 * object's zone count, undefined with no active object.
 */
export function ModeSections({ ui, run, zones }: {
  ui: UiState;
  run: (id: CommandId) => void;
  zones: number | undefined;
}) {
  const edit = resolve('mode.edit', ui);
  const zonesMode = resolve('mode.zones', ui);
  // Said only when both buttons are off outside a mode: no object, or a heavy one.
  const waiting = ui.mode === 'off' && !edit.enabled && !zonesMode.enabled ? edit.disabledReason : undefined;
  return <section>
    <h3>{t('Modes')}</h3>
    <CommandButton command={edit} run={run} pressed locked={ui.mode !== 'off' && !edit.enabled} />
    <CommandButton command={zonesMode} run={run} pressed locked={ui.mode !== 'off' && !zonesMode.enabled} className="mode-button">
      {zones !== undefined && !zonesMode.pressed && <small className="state">{zones ? t('Painted') : t('None')}</small>}
    </CommandButton>
    {waiting && <p className="help">{translateMessage(waiting)}</p>}
  </section>;
}
