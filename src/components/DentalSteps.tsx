import { useRef } from 'react';
import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { Gesture } from '../editing/gesture';
import type { DentalNotice, SessionEvent } from '../editing/session';
import { ALIGNER_PROFILES, profileById, profilesWithoutOpening, type AlignerProfile } from '../dental/alignerProfiles';
import { t, translateMessage, type Lang } from '../i18n';
import { CommandButton } from './CommandButton';

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

/** Step 1 after the aligner is oriented: the notices, the type-mismatch choice, Auto orientation, Back, Exit, Next. */
export function DentalAlignerBar({ notices, proposal, profile, lang, ui, send, run }: {
  notices: readonly DentalNotice[];
  proposal: Extract<Gesture, { kind: 'dental-aligner' }>['proposal'];
  profile: string | undefined;
  lang: Lang;
  ui: UiState;
  send: (event: SessionEvent) => void;
  run: (id: CommandId) => void;
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
