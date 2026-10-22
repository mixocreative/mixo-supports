import { editModeButton, zonesButton } from '../editing/modeButtons';
import type { EditSession, SessionEvent } from '../editing/session';
import { heavyStatus } from '../editing/status';
import { t, translateMessage } from '../i18n';
import { hint } from './hint';
import { ClearZonesButton } from './ZonesBar';

/**
 * The left panel's way into the two modes: Support Edit Mode and no-support zones, each button
 * turning into its mode's exit while the mode is on (editing/modeButtons). `zones`: the active
 * object's zone count, undefined with no active object.
 */
export function ModeSections({ session, zones, send, onClearZones }: {
  session: EditSession;
  zones: number | undefined;
  send: (event: SessionEvent) => void;
  onClearZones: () => void;
}) {
  const edit = editModeButton(session);
  const paint = zonesButton(session);
  const heavy = heavyStatus(session);
  return <>
    <section>
      <h3>{t('Edit supports')}</h3>
      <button aria-pressed={edit.pressed} onClick={() => send(edit.event)} disabled={edit.disabled} {...hint(edit.hint)}>{t(edit.label)}</button>
      <p className="help">{heavy ? translateMessage(heavy) : zones !== undefined ? t('Add or remove supports by clicking the model. Tab toggles.') : t('Select an object first.')}</p>
    </section>
    <section>
      <h3>{t('No-support zones')}{zones !== undefined && <small className="count">{zones ? t('Painted') : t('None')}</small>}</h3>
      {/* Stacked full width like Edit supports: the Exit label fits on one line in every language. */}
      <button aria-pressed={paint.pressed} onClick={() => send(paint.event)} disabled={paint.disabled} {...hint(paint.hint)}>{t(paint.label)}</button>
      <ClearZonesButton compact disabled={!zones} onClear={onClearZones} />
      <p className="help">{t('Paint where supports must not grow. Manual supports stay.')}</p>
    </section>
  </>;
}

/** The viewport's Edit supports button outside the modes (Tab does the same); its hint says why it is off. */
export function ViewportEditToggle({ session, hasObject, send }: { session: EditSession; hasObject: boolean; send: (event: SessionEvent) => void }) {
  const edit = editModeButton(session);
  const heavy = heavyStatus(session);
  return <button className="viewport-edit-toggle" onClick={() => send(edit.event)} disabled={edit.disabled} {...hint(heavy ? heavy.key : hasObject ? 'Add or remove supports by clicking (Tab)' : 'Select an object first.', heavy?.vars)}>
    {t('Edit supports')}
  </button>;
}
