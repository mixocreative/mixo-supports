import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { StatusMessage } from '../editing/types';
import { t, translateMessage } from '../i18n';
import { CommandButton } from './CommandButton';
import { ClearZonesButton } from './ZonesBar';

/**
 * The left panel's way into the two modes: Support Edit Mode and no-support zones, each button
 * turning into its mode's exit while the mode is on (the registry's mode.edit and mode.zones rows).
 * `zones`: the active object's zone count, undefined with no active object; `heavy`: why a heavy
 * object takes no hand edits.
 */
export function ModeSections({ ui, run, zones, heavy, onClearZones }: {
  ui: UiState;
  run: (id: CommandId) => void;
  zones: number | undefined;
  heavy: StatusMessage | undefined;
  onClearZones: () => void;
}) {
  return <>
    <section>
      <h3>{t('Edit supports')}</h3>
      <CommandButton command={resolve('mode.edit', ui)} run={run} pressed />
      <p className="help">{heavy ? translateMessage(heavy) : zones !== undefined ? t('Add or remove supports by clicking the model.') : t('Select an object first.')}</p>
    </section>
    <section>
      <h3>{t('No-support zones')}{zones !== undefined && <small className="count">{zones ? t('Painted') : t('None')}</small>}</h3>
      {/* Stacked full width like Edit supports: the Exit label fits on one line in every language. */}
      <CommandButton command={resolve('mode.zones', ui)} run={run} pressed />
      <ClearZonesButton compact disabled={!zones} onClear={onClearZones} />
      <p className="help">{t('Paint where supports must not grow. Manual supports stay.')}</p>
    </section>
  </>;
}

/** The viewport's Edit supports button outside the modes; its hint says why it is off. */
export function ViewportEditToggle({ ui, run }: { ui: UiState; run: (id: CommandId) => void }) {
  return <CommandButton command={resolve('vp.editToggle', ui)} run={run} className="viewport-edit-toggle" />;
}
