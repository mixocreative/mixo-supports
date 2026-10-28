import { useRef } from 'react';
import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { Gesture } from '../editing/gesture';
import type { DentalNotice, SessionEvent } from '../editing/session';
import { ALIGNER_PROFILES, profileById, profilesWithoutOpening, type AlignerProfile } from '../dental/alignerProfiles';
import { t, translateMessage, type Lang } from '../i18n';
import { CommandButton } from './CommandButton';
import { RangeField } from './RangeField';
import { profileData } from '../dental/alignerProfiles';
import { tiltLabel, type TiltRow, type TiltRule } from '../core/analysis/dentalTilt';
import type { DentalTiltState } from './useDentalFlow';

/** The problem-list name of each print-angle rule. */
export const TILT_RULE_NAMES: Record<TiltRule, string> = {
  'resin-trap': 'resin trap',
  'rim-gap': 'gap in the rim supports',
  crossing: 'support crossing the aligner',
  'too-thin': 'support too thin for its height',
};

/** The rules a tilt fails, by name (empty when it passes every rule). */
export function tiltFlags(row: TiltRow): string[] {
  return row.failed.map((failure) => t(TILT_RULE_NAMES[failure.rule]));
}

/** The problem-list entries of a pick when no tilt passes: per failed rule, the tilt and the first failing vertex or tip. */
export function tiltProblems(row: TiltRow): string[] {
  return row.failed.map((failure) => t('{rule} at {n}° ({at})', { rule: t(TILT_RULE_NAMES[failure.rule]), n: tiltLabel(row.tiltDeg), at: failure.at }));
}

/** The top-view line art of one profile, in the card's ink colour. */
function ProfileArt({ profile }: { profile: AlignerProfile }) {
  return <svg className="dental-card-art" viewBox="0 0 120 90" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {profile.card.map((d) => <path key={d} d={d} />)}
  </svg>;
}

/** The message of one notice, in the words of Step 1 and Step 2. */
export function noticeText(notice: DentalNotice): string {
  switch (notice.kind) {
    case 'bad-file': return translateMessage(notice.message);
    case 'failed': return t('The aligner could not be oriented automatically. It stays as dropped: rotate it with the gizmo, then press Next.');
    case 'uncertain': return t('Automatic orientation is uncertain. The aligner stays as dropped: adjust it with the rotation gizmo, then press Next.');
    case 'holes': return t('This file has holes or non-manifold geometry. Detection may be unreliable: check the result before you continue.');
    case 'mismatch': return t('This looks like a different aligner type: no central opening was found.');
    case 'no-area': return t('No support area was detected on this aligner. Mark where supports may go. Next stays off until some area is marked.');
    case 'angle-moved': return t('Print angle moved to {n}°', { n: notice.deg });
  }
}

/** Step 0: one large card per aligner profile; a click selects it and goes to Step 1. */
export function DentalTypeStep({ profile, lang, send }: {
  profile: string | undefined;
  lang: Lang;
  send: (event: SessionEvent) => void;
}) {
  return <div className="dental-stage" role="group" aria-label={t('Aligner type')}>
    <h2>{t('Choose the aligner type')}</h2>
    <div className="dental-cards">
      {ALIGNER_PROFILES.map((entry) => <button key={entry.id} type="button" className="dental-card" aria-pressed={profile === entry.id}
        data-profile={entry.id} onClick={() => send({ type: 'chooseDentalProfile', id: entry.id })}>
        <ProfileArt profile={entry} />
        <strong>{entry.name[lang]}</strong>
        <small>{entry.description[lang]}</small>
      </button>)}
    </div>
  </div>;
}

/** Step 1 before an aligner is oriented: the drop zone and upload button, or the loading line. */
export function DentalAlignerPrompt({ phase, notices, selectedName, onFiles, onUseSelected }: {
  phase: Extract<Gesture, { kind: 'dental-aligner' }>['phase'];
  notices: readonly DentalNotice[];
  selectedName: string | undefined;
  onFiles: (files: File[]) => void;
  onUseSelected: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  if (phase === 'loading') return <div className="dental-stage" role="status" aria-busy="true">
    <h2>{t('Checking and orienting the aligner…')}</h2>
  </div>;
  const bad = notices.find((notice) => notice.kind === 'bad-file');
  return <div className="dental-stage">
    <div className="dental-drop">
      <h2>{t('Drop the aligner STL here')}</h2>
      <p>{t('The aligner is checked and turned the right way up automatically.')}</p>
      <input ref={input} type="file" accept=".stl,.glb,.gltf" aria-label={t('Choose aligner file')} hidden
        onChange={(event) => { onFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
      <div className="edit-row">
        <button type="button" className="primary" onClick={() => input.current?.click()}>{t('Choose STL file')}</button>
        {selectedName ? <button type="button" onClick={onUseSelected}>{t('Use the selected model')}</button> : null}
      </div>
      {bad ? <p className="dental-problem" role="alert">{noticeText(bad)}</p> : null}
    </div>
  </div>;
}

/**
 * Step 1's print angle (docs/ROADMAP.md F): the scan's progress, then the chosen angle with the
 * stable band, a slider over the type's tilt range (band highlighted) and that tilt's rule flags.
 */
export function PrintAngleField({ tilt, profile, onChoose }: {
  tilt: DentalTiltState;
  profile: string;
  onChoose: (index: number) => void;
}) {
  if (tilt.status === 'scanning') return <p className="edit-note" role="status">{t('Scanning print angles {i}/{n}', { i: tilt.done, n: tilt.total })}</p>;
  if (tilt.status === 'failed') return <p className="edit-note" role="alert">{t('The print angles could not be scanned. The detected angle is kept.')}</p>;
  const { scan, index } = tilt;
  const { tiltRangeDeg, tiltStepDeg } = profileData(profile).pose;
  const row = scan.rows[index]!;
  const band = scan.band ? [scan.rows[scan.band[0]]!.tiltDeg, scan.rows[scan.band[1]]!.tiltDeg] as const : undefined;
  const flags = tiltFlags(row);
  const pick = scan.rows[scan.order[0]!]!;
  return <div className="print-angle" role="group" aria-label={t('Print angle')}>
    <p className="edit-hint" role="status">{band
      ? t('Print angle {n}° (stable {a}–{b}°)', { n: tiltLabel(row.tiltDeg), a: tiltLabel(band[0]), b: tiltLabel(band[1]) })
      : t('Print angle {n}° (no stable angle)', { n: tiltLabel(row.tiltDeg) })}</p>
    <RangeField layout="row" label="Print angle" unit="{n}°" hint="Tilt of the aligner on the plate. The highlighted part of the track is the stable band"
      min={scan.startDeg - tiltRangeDeg} max={scan.startDeg + tiltRangeDeg} step={tiltStepDeg} value={row.tiltDeg} display={tiltLabel(row.tiltDeg)} band={band}
      onChange={(value) => {
        const nearest = scan.rows.reduce((best, candidate, at) => (Math.abs(candidate.tiltDeg - value) < Math.abs(scan.rows[best]!.tiltDeg - value) ? at : best), 0);
        if (nearest !== index) onChoose(nearest);
      }} />
    <p className="edit-note tilt-flags" role="note">{flags.length > 0 ? flags.join(' · ') : t('Passes every rule.')}</p>
    {scan.reason === 'failing' ? <ul className="problems" aria-label={t('No print angle passes every rule.')}>
      <li><span className="problem-kind angle" aria-hidden="true" /><span className="problem-text">{t('No print angle passes every rule.')}
        {tiltProblems(pick).map((line) => <small key={line}>{line}</small>)}</span></li>
    </ul> : null}
  </div>;
}

/** Step 1 after the aligner is oriented: the notices, the type-mismatch choice, Auto orientation, Back, Exit, Next. */
export function DentalAlignerBar({ notices, proposal, profile, lang, ui, send, run, tilt, onTilt }: {
  notices: readonly DentalNotice[];
  proposal: Extract<Gesture, { kind: 'dental-aligner' }>['proposal'];
  profile: string | undefined;
  lang: Lang;
  ui: UiState;
  send: (event: SessionEvent) => void;
  run: (id: CommandId) => void;
  tilt?: DentalTiltState | undefined;
  onTilt?: (index: number) => void;
}) {
  const current = profileById(profile);
  const alternatives = profilesWithoutOpening();
  return <div className="edit-bar">
    <div className="edit-row">
      {proposal ? <span className="edit-hint">{t('Detector confidence {n}%', { n: Math.round(proposal.diagnostics.confidence * 100) })}</span> : null}
      <CommandButton command={resolve('dental.useDetected', ui)} run={run} />
      <CommandButton command={resolve('dental.back', ui)} run={run} />
      <CommandButton command={resolve('dental.exit', ui)} run={run} />
      <CommandButton command={resolve('dental.next', ui)} run={run} />
    </div>
    {tilt && profile ? <PrintAngleField tilt={tilt} profile={profile} onChoose={(index) => onTilt?.(index)} /> : null}
    {notices.map((notice) => <div key={notice.kind} className="dental-notice">
      <p className="edit-note" role="alert">{noticeText(notice)}</p>
      {notice.kind === 'mismatch' ? <div className="edit-row">
        {alternatives.map((entry) => <button key={entry.id} type="button" onClick={() => send({ type: 'switchDentalProfile', id: entry.id })}>{t('Switch to {name}', { name: entry.name[lang] })}</button>)}
        <button type="button" onClick={() => send({ type: 'dismissDentalNotice', kind: 'mismatch' })}>{t('Keep {name}', { name: current ? current.name[lang] : '' })}</button>
      </div> : null}
    </div>)}
    <p className="edit-note" role="note">{t('Auto orientation only rotates the aligner. Adjust with the rotation gizmo, then press Next.')}</p>
  </div>;
}
