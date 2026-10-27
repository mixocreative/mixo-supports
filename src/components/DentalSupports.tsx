import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { EditGesture } from '../editing/gesture';
import { FIX_TOOL_EVENTS, type SessionEvent } from '../editing/session';
import type { DentalStructure } from '../core/analysis/dentalPolicy';
import type { SupportProblem } from '../core/analysis/supportCheck';
import { settingLimits, type LiveSupportSettings, type SettingKey } from '../core/supports/settings';
import { DENTAL_LABEL_MAX, DEFAULT_DENTAL_LABEL, filterDentalLabel } from '../dental/label';
import { t } from '../i18n';
import { CommandButton } from './CommandButton';
import { EditTools } from './EditBar';
import { hint } from './hint';
import { ProblemList } from './ProblemList';
import { RangeField } from './RangeField';

/** Rim coverage as the support build reports it, or `unavailable` when it could not be measured. */
export type RimGap = { outerMm: number; openingMm: number } | 'unavailable';

type Problem = SupportProblem & { unitId: string; inZone: boolean };

/** What Step 3 needs from the host: the active aligner's settings, results and the actions on them. */
export interface DentalReview {
  settings: Readonly<LiveSupportSettings>;
  onSetting: <K extends SettingKey>(key: K, value: LiveSupportSettings[K], edit?: string) => void;
  /** Support density of the strip (Step 2's setting, kept in step); a change places the contacts again. */
  density: number;
  densityBusy: boolean;
  onDensity: (density: number) => void;
  structure: Readonly<DentalStructure>;
  onStructure: (structure: DentalStructure) => void;
  clickReach: { value: number; onChange: (value: number, edit?: string) => void };
  rimGap: RimGap | undefined;
  structureFallback: readonly ('tree' | 'brace')[] | undefined;
  problems: readonly Problem[];
  outOfDate: boolean;
  rechecking: (problem: Problem) => boolean;
  unitName: (unitId: string) => string;
  onShow: (problem: Problem) => void;
  onFix: (problem: Problem) => void;
  onShowRim: () => void;
  /** Finished aligners already on the plate, for the Add another aligner line. */
  finishedCount: number;
  /** Back would discard hand work: what it would throw away, until the user answers. */
  backAsk: { added: number; removed: number; customised: number } | undefined;
  onBackConfirm: () => void;
  onBackCancel: () => void;
}

/** One finding of the rim or the structure, listed with the check's findings: Show frames the rim, Fix opens Add supports. */
function NoteProblem({ text, onShow, onFix }: { text: string; onShow: () => void; onFix: () => void }) {
  return <li className="dental-problem-row">
    <span className="problem-kind overhang" aria-hidden="true" />
    <span className="problem-text">{text}</span>
    <button type="button" onClick={onShow} {...hint('Frame the camera on this spot')}>{t('Show me')}</button>
    <button type="button" onClick={onFix} {...hint('Add a support by hand where one is missing')}>{t('Fix')}</button>
  </li>;
}

/**
 * Dental Step 3: the supports as built, their key settings, the Support Edit Mode tools, the
 * problem list, the label, and the two ways to finish. Settings are the active aligner's own.
 */
export function DentalSupportsStep({ gesture, ui, review, ready, send, run }: {
  gesture: EditGesture;
  ui: UiState;
  review: DentalReview;
  ready: boolean;
  send: (event: SessionEvent) => void;
  run: (id: CommandId) => void;
}) {
  const { settings, onSetting } = review;
  const tipKey: 'pointDiameter' | 'touchDiameter' = settings.contactShape === 'SPHERE' ? 'touchDiameter' : 'pointDiameter';
  const rimNote = review.rimGap === 'unavailable'
    ? t('Rim coverage could not be verified. Review the rim and supports before finishing.')
    : review.rimGap ? t('Automatic rim gaps: outer {outer} mm, opening {opening} mm. Review the rim; omitted contacts were not forced.', { outer: review.rimGap.outerMm.toFixed(1), opening: review.rimGap.openingMm.toFixed(1) }) : undefined;
  const fixHere = () => FIX_TOOL_EVENTS.forEach(send);
  const notes: { key: string; text: string }[] = [
    ...(rimNote ? [{ key: 'rim', text: rimNote }] : []),
    ...(review.structureFallback?.includes('tree') ? [{ key: 'tree', text: t('Tree branches were omitted because they crossed the model. Review the supports before finishing.') }] : []),
    ...(review.structureFallback?.includes('brace') ? [{ key: 'brace', text: t('Cross-braces were omitted because they crossed the model. Review the supports before finishing.') }] : []),
  ];
  const finishing = resolve('dental.finish', ui);
  return <aside className="dental-side" aria-label={t('Step 3 · Supports')}>
    <div className="dental-scroll">
    {!ready && <p className="edit-note" role="status">{t('Building supports…')}</p>}
    <section className="dental-block" aria-label={t('Support settings')}>
      <h3>{t('Support settings')}</h3>
      <RangeField layout="stack" label="Tip size" unit="{n} mm" hint="Diameter of each support tip where it touches the aligner"
        min={0.1} max={1} step={0.05} value={Number(settings[tipKey].toFixed(2))}
        onChange={(value) => onSetting(tipKey, value, `dental-${tipKey}`)} />
      <RangeField layout="stack" label="Support density" unit="{n}×" hint="Higher density places support tips closer together. Your manual edits are kept where they still fit"
        min={0.5} max={2} step={0.1} value={review.density}
        onChange={review.onDensity} />
      {review.densityBusy && <p className="edit-note" role="status">{t('Updating support area and tips…')}</p>}
      <RangeField layout="stack" label="Lift height" unit="{n} mm" hint="How high the aligner stands above the plate. Supports are placed again"
        min={settingLimits.liftHeight.min} max={15} step={0.5} value={settings.liftHeight}
        onChange={(value) => onSetting('liftHeight', value, 'dental-lift')} />
      <label className="check" {...hint('Build a raft under the supports. The label needs it')}>
        <input type="checkbox" checked={settings.raftEnabled} onChange={(event) => onSetting('raftEnabled', event.target.checked)} />{t('Raft')}
      </label>
      <label className="check"><input type="checkbox" checked={review.structure.treeEnabled}
        onChange={(event) => review.onStructure({ ...review.structure, treeEnabled: event.target.checked })} />{t('Tree branches')}</label>
      <label className="check"><input type="checkbox" checked={review.structure.bracesEnabled}
        onChange={(event) => review.onStructure({ ...review.structure, bracesEnabled: event.target.checked })} />{t('Cross-braces')}</label>
    </section>
    <section className="dental-block" aria-label={t('Edit supports')}>
      <h3>{t('Edit supports')}</h3>
      <div className="dental-tools">
        <EditTools gesture={gesture} ui={ui} clickReach={review.clickReach} send={send} run={run} />
      </div>
    </section>
    <section className="dental-block" aria-label={t('Problems')}>
      <h3>{t('Problems')}</h3>
      <CommandButton command={resolve('check.run', ui)} run={run} />
      {notes.length > 0 && <ul className="problems">
        {notes.map((note) => <NoteProblem key={note.key} text={note.text} onShow={review.onShowRim} onFix={fixHere} />)}
      </ul>}
      <ProblemList problems={review.problems} outOfDate={review.outOfDate} rechecking={review.rechecking} unitName={review.unitName} onShow={review.onShow} onFix={review.onFix} />
      {notes.length === 0 && review.problems.length === 0 && <p className="help">{t('No problems listed. Press Check supports to look for islands and overhangs.')}</p>}
    </section>
    </div>
    <div className="dental-footer">
    <section className="dental-block" aria-label={t('Label')}>
      <label className="field-row" {...hint('Letters, digits and "-" only, up to 8. Embossed on the raft so printed aligners can be told apart')}>
        <span>{t('Label')}</span>
        <input className="text dental-label" type="text" inputMode="text" autoComplete="off" spellCheck={false} value={settings.labelText}
          placeholder={DEFAULT_DENTAL_LABEL} aria-label={t('Label')} data-max={DENTAL_LABEL_MAX}
          onChange={(event) => onSetting('labelText', filterDentalLabel(event.target.value), 'dental-label')} />
      </label>
      {!settings.raftEnabled && <p className="help" role="note">{t('The label is embossed on the raft. Turn the raft on to print it.')}</p>}
    </section>
    {review.backAsk ? <section className="dental-block dental-confirm" role="alertdialog" aria-label={t('Go back?')}>
      <p className="edit-note" role="alert">{t('Going back discards your manual support edits ({added} added, {removed} removed, {customised} with own settings). Continue?', review.backAsk)}</p>
      <div className="edit-row">
        <button type="button" onClick={review.onBackCancel}>{t('Stay')}</button>
        <button type="button" className="danger" onClick={review.onBackConfirm}>{t('Discard and go back')}</button>
      </div>
    </section> : <section className="dental-block dental-finish">
      {review.finishedCount > 0 && <p className="help">{t('Aligners finished so far: {n}', { n: review.finishedCount })}</p>}
      <div className="edit-row">
        <CommandButton command={resolve('dental.back', ui)} run={run} />
        <CommandButton command={resolve('dental.exit', ui)} run={run} />
      </div>
      <div className="edit-row">
        <CommandButton command={resolve('dental.addAnother', ui)} run={run} />
        <CommandButton command={finishing} run={run} />
      </div>
    </section>}
    </div>
  </aside>;
}
