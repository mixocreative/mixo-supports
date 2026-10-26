import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { Gesture } from '../editing/gesture';
import { t } from '../i18n';
import { defaultDentalTuning, type DentalTuning } from '../core/analysis/dentalTuning';
import { CommandButton } from './CommandButton';
import { DoneButton } from './EditBar';
import { RangeField } from './RangeField';
import { SurfaceBrushBar } from './SurfaceBrushBar';

/** Dental Auto Generate chrome: review the detector first, then mark only permitted support area. */
export function DentalBar({ gesture, unitName, ui, tipCount = 0, previewStatus = 'loading', reviewReady = true, rimGap,
  tuning = defaultDentalTuning, tuningBusy = false, tuningError = false, onTuningChange, send, run }: {
  gesture: Extract<Gesture, { kind: 'dental-orientation' | 'dental-area' | 'dental-review' }>;
  unitName: string | undefined;
  ui: UiState;
  tipCount?: number;
  previewStatus?: 'idle' | 'loading' | 'ready' | 'error';
  reviewReady?: boolean;
  rimGap?: { outerMm: number; openingMm: number } | 'unavailable';
  tuning?: DentalTuning;
  tuningBusy?: boolean;
  tuningError?: boolean;
  onTuningChange?: (tuning: DentalTuning) => void;
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
  if (gesture.kind === 'dental-review') return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Step 3 · Review supports')}<span>{unitName}</span>
      <b>{t('Review the generated supports, then finish.')}</b>
    </div>
    <div className="edit-bar"><div className="edit-row">
      <CommandButton command={resolve('dental.back', ui)} run={run} />
      {reviewReady ? <DoneButton ui={ui} run={run} /> : <span className="edit-hint" role="status">{t('Building supports…')}</span>}
    </div>
      {reviewReady && rimGap ? <p className="edit-note" role="alert">{rimGap === 'unavailable'
        ? t('Rim coverage could not be verified. Review the rim and supports before finishing.')
        : t('Automatic rim gaps: outer {outer} mm, opening {opening} mm. Review the rim; omitted contacts were not forced.',
          { outer: rimGap.outerMm.toFixed(1), opening: rimGap.openingMm.toFixed(1) })}</p> : null}
    </div>
  </>;
  return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Step 2 · Support area')}<span>{unitName}</span>
      <b>{t('Support area is marked. Press Next, or paint to adjust.')}</b>
    </div>
    <SurfaceBrushBar
      className="dental-brush"
      label="Dental area marker"
      kind={gesture.brush.kind}
      options={[
        { value: 'allow', label: t('Add area'), hint: 'Allow dental supports on this model surface' },
        { value: 'erase', label: t('Remove area'), hint: 'Remove dental support permission from this model surface' },
      ]}
      onKindChange={(kind) => send({ type: 'setDentalKind', kind })}
      radius={gesture.brush.radius}
      onRadiusChange={(radius) => send({ type: 'setDentalRadius', radius })}
      note={<>
        <div className="edit-row dental-tuning" role="group" aria-label={t('Aligner contact strip')}>
          <RangeField layout="row" label="Strip width" unit="{n} mm" hint="Width of the permitted strip beside each rim"
            min={0.2} max={2.4} step={0.1} value={tuning.stripWidthMm}
            onChange={(stripWidthMm) => onTuningChange?.({ ...tuning, stripWidthMm })} />
          <RangeField layout="row" label="Support density" unit="{n}×" hint="Higher density places proposed tips closer together"
            min={0.5} max={2} step={0.1} value={tuning.density}
            onChange={(density) => onTuningChange?.({ ...tuning, density })} />
          <details><summary>{t('Advanced position')}</summary>
            <RangeField layout="row" label="Rim setback" unit="{n} mm" hint="Move the strip away from the trim rim on its non-cavity side"
              min={0} max={1} step={0.1} value={tuning.setbackMm}
              onChange={(setbackMm) => onTuningChange?.({ ...tuning, setbackMm })} />
          </details>
        </div>
        {tuningBusy && <p className="edit-note" role="status">{t('Updating support area and tips…')}</p>}
        {tuningError && <p className="edit-note" role="alert">{t('Could not update the support strip. The previous area is still active.')}</p>}
        <p className="edit-note" role="note">{t('Drag on the model to paint; drag empty space to rotate the view. Proposed support tips: {n}. Final generation may exclude tips whose supports touch an unapproved face.', { n: tipCount })}</p>
        {previewStatus !== 'ready' || tipCount === 0 ? <p className="edit-note" role="status">{t(previewStatus === 'error'
          ? 'Could not preview safe support tips. Adjust the area or retry.'
          : previewStatus === 'ready' ? 'No safe support tips were found. Automatic placement is paused.'
            : 'Finding safe support tips…')}</p> : null}
      </>}
      actions={<>
        <CommandButton command={resolve('dental.generate', tuningBusy ? { ...ui, dentalPreviewReady: false } : ui)} run={run} />
      </>}
    />
  </>;
}
