import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { Gesture } from '../editing/gesture';
import type { SessionEvent } from '../editing/session';
import { plural, t } from '../i18n';
import { CommandButton } from './CommandButton';
import { DoneButton } from './EditBar';
import { KeyCaps } from './KeyCaps';
import { SurfaceBrushBar } from './SurfaceBrushBar';

/**
 * Zones mode's chrome over the viewport: the red frame and badge (the zone colour stays on the model), and the bar with
 * the brush, a note while the camera is above the plate (supports attach underneath), Clear and Done.
 */
export function ZonesBar({ brush, unitName, belowPlate, hidden, ui, send, run }: {
  brush: Extract<Gesture, { kind: 'zones' }>['brush'];
  unitName: string | undefined;
  belowPlate: boolean;
  /** Supports the zones hide in the build the viewport shows. */
  hidden: number;
  ui: UiState;
  send: (event: SessionEvent) => void;
  run: (id: CommandId) => void;
}) {
  return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Painting no-support zones')}<span>{unitName}</span>
      <b>{plural(hidden, '1 support hidden by zones', '{n} supports hidden by zones')}</b>
    </div>
    <SurfaceBrushBar
      label="Zone brush"
      kind={brush.kind}
      onKindChange={(kind) => send({ type: 'setZoneKind', kind })}
      options={[
          { value: 'paint', label: t('Paint'), hint: 'Paint no-support zones on the model' },
          { value: 'erase', label: t('Erase'), hint: 'Erase no-support zones from the model' },
      ]}
      radius={brush.radius}
      onRadiusChange={(radius) => send({ type: 'setZoneRadius', radius })}
      beforeActions={<span className="edit-hint"><KeyCaps shortcut={resolve('history.undo', ui).shortcut!} /> {t('undo')}</span>}
      note={!belowPlate && <p className="edit-note" role="note">{t('Supports attach underneath: turn the view (Bottom view) to paint where they are.')}</p>}
      actions={<>
        <CommandButton command={resolve('zones.clearAll', ui)} run={run} />
        <DoneButton ui={ui} run={run} />
      </>}
    />
  </>;
}
