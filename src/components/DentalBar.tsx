import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { Gesture } from '../editing/gesture';
import { t } from '../i18n';
import { CommandButton } from './CommandButton';
import { DoneButton } from './EditBar';
import { SurfaceBrushBar } from './SurfaceBrushBar';

/** Dental Auto Generate chrome: review the detector first, then mark only permitted support area. */
export function DentalBar({ gesture, unitName, ui, send, run }: {
  gesture: Extract<Gesture, { kind: 'dental-orientation' | 'dental-area' }>;
  unitName: string | undefined;
  ui: UiState;
  send: (event: { type: 'setDentalKind'; kind: 'allow' | 'erase' } | { type: 'setDentalRadius'; radius: number }) => void;
  run: (id: CommandId) => void;
}) {
  if (gesture.kind === 'dental-orientation') return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Step 1 · Orientation')}<span>{unitName}</span>
      <b>{t('Review the detected lower opening before changing orientation.')}</b>
    </div>
    <div className="edit-bar">
      <div className="edit-row">
        <span className="edit-hint">{t('Detector confidence {n}%', { n: Math.round(gesture.proposal.diagnostics.confidence * 100) })}</span>
        <CommandButton command={resolve('dental.useDetected', ui)} run={run} />
        <CommandButton command={resolve('dental.next', ui)} run={run} />
      </div>
      <p className="edit-note" role="note">{t('Auto orientation only rotates the aligner. Adjust with the rotation gizmo, then press Next.')}</p>
    </div>
  </>;
  return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Dental support area')}<span>{unitName}</span>
      <b>{t('Mark where supports may grow; Remove clears permission.')}</b>
    </div>
    <SurfaceBrushBar
      label="Dental area marker"
      kind={gesture.brush.kind}
      options={[
        { value: 'allow', label: t('Allow'), hint: 'Allow dental supports on this model surface' },
        { value: 'erase', label: t('Remove'), hint: 'Remove dental support permission from this model surface' },
      ]}
      onKindChange={(kind) => send({ type: 'setDentalKind', kind })}
      radius={gesture.brush.radius}
      onRadiusChange={(radius) => send({ type: 'setDentalRadius', radius })}
      note={<p className="edit-note" role="note">{t('Only the detected lower opening and your marked area can receive dental supports.')}</p>}
      actions={<>
        <CommandButton command={resolve('dental.generate', ui)} run={run} />
        <DoneButton ui={ui} run={run} secondary />
      </>}
    />
  </>;
}
