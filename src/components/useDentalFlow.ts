import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { defaultDentalTuning } from '../dental/tuning';
import type { Vector } from '../core/vec3';
import type { GizmoMode, ViewRequest } from './viewport/types';
import type { PrintScene, PrintUnit, SceneCommand, SupportSettings } from '../state/project';
import type { DentalNotice, EditSession, SessionEvent } from '../editing/session';
import type { AnalysisClient } from '../workers/analysisClient';
import { arrangeAlignerCommands } from '../dental/arrange';
import { manualAreaPolicy } from '../dental/manualArea';
import { dentalStructureOf, dentalSupportSettings } from '../dental/supportPreset';
import { resolveSettings } from '../supports/unitSupports';
import type { TiltScan } from '../core/analysis/dentalTilt';
import type { LiveSupportSettings } from '../core/supports/settings';
import type { DentalStructure } from '../core/analysis/dentalPolicy';
import { profileData } from '../dental/alignerProfiles';
import { tiltLabel } from '../core/analysis/dentalTilt';

/**
 * Step 1's print-angle search (docs/ROADMAP.md F): scanning (tilts done of total), the scan with
 * the row shown (`index`) and whether the operator chose it by hand, or why it could not run.
 */
export type DentalTiltState =
  | { status: 'scanning'; unitId: string; done: number; total: number }
  | { status: 'ready'; unitId: string; scan: Extract<TiltScan, { kind: 'scan' }>; index: number; hand: boolean; confirming: boolean }
  | { status: 'failed'; unitId: string; reason: string };

/** The tilts a profile scans (Rust `tilt::scan_steps`). */
export function tiltCount(profile: string): number {
  const { tiltRangeDeg, tiltStepDeg } = profileData(profile).pose;
  return 2 * Math.floor(tiltRangeDeg / tiltStepDeg + 1e-9) + 1;
}

/*
 * The dental flow's Steps 1 and 2 orchestration, out of App: orient a dropped aligner in the
 * analysis worker (Rust `orient_dental` for the chosen aligner type), offer the detected pose, and
 * detect the support area (Rust `propose_dental_region`) into the unit's policy. Every decision is
 * the worker's; this hook only sequences jobs, drops stale answers and dispatches the results.
 */

interface DentalFlowHost {
  analysis: () => AnalysisClient;
  dispatch: (command: SceneCommand) => void;
  send: (event: SessionEvent) => void;
  sceneRef: MutableRefObject<PrintScene>;
  sessionRef: MutableRefObject<EditSession>;
  /** The session as rendered (the hook re-orients when Step 1 switches the aligner type). */
  session: EditSession;
  setStatus: (key: string) => void;
  requestView: (kind: ViewRequest['kind']) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  unitName: (unitId: string) => string;
}

/** The support settings and switches this aligner will be built with in Step 3 (the type's preset for a new aligner). */
function alignerSettings(unit: PrintUnit, profile: string): { settings: LiveSupportSettings; structure: DentalStructure } {
  const own = unit.dental?.profileId === profile;
  const settings = own ? resolveSettings(unit.settings) : dentalSupportSettings(profile, resolveSettings(unit.settings));
  const kept = own && unit.dental?.kind === 'two-contour' ? unit.dental.structure : undefined;
  return { settings, structure: kept ?? dentalStructureOf(profile) };
}

/** The type's Step 3 settings for a new aligner, or one whose type changed; otherwise the operator's are kept. */
function presetCommands(unit: PrintUnit, profile: string): SceneCommand[] {
  if (unit.dental?.profileId === profile) return [];
  return [{ type: 'settings/set', unitId: unit.id, settings: dentalSupportSettings(profile, resolveSettings(unit.settings)) as SupportSettings }];
}

export function useDentalFlow({ analysis, dispatch, send, sceneRef, sessionRef, session, setStatus, requestView, setGizmoMode, unitName }: DentalFlowHost) {
  const orientSeq = useRef(0);
  const detectionSeq = useRef(0);
  /** The pose Step 1 found for the current proposal (`orient_dental` returns it with the rim). */
  const detected = useRef<{ unitId: string; profile: string; rotation: Vector | undefined } | undefined>(undefined);
  const scanSeq = useRef(0);
  const [tilt, setTiltState] = useState<DentalTiltState | undefined>(undefined);
  const tiltRef = useRef<DentalTiltState | undefined>(undefined);
  const setTilt = useCallback((next: DentalTiltState | undefined) => { tiltRef.current = next; setTiltState(next); }, []);
  /** One scan per file and aligner type: the source mesh it was made for. */
  const scanned = useRef<{ unitId: string; profile: string; source: PrintUnit['source']; tilt: DentalTiltState } | undefined>(undefined);
  const keepTilt = useCallback((next: DentalTiltState) => {
    setTilt(next);
    if (scanned.current?.unitId === next.unitId) scanned.current = { ...scanned.current, tilt: next };
  }, [setTilt]);

  /** Turns the aligner to `rotation` and lays the session's aligners out again (its footprint changed). */
  const turnTo = useCallback((unitId: string, rotation: Vector) => {
    const current = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (!current) return;
    const turned = { ...current, transform: { ...current.transform, rotation } };
    const units = sceneRef.current.units.map((candidate) => (candidate.id === unitId ? turned : candidate));
    dispatch({ type: 'batch', commands: [{ type: 'transform/set', unitId, transform: turned.transform }, ...arrangeAlignerCommands(units, [...sessionRef.current.dentalFinished, unitId])] });
  }, [dispatch, sceneRef, sessionRef]);

  /** Step 1: the print-angle search, once per file, after orientation; the pick becomes the detected pose. */
  const startScan = useCallback((unit: PrintUnit, profile: string) => {
    const last = scanned.current;
    if (last && last.unitId === unit.id && last.profile === profile && last.source === unit.source) {
      setTilt(last.tilt);
      if (last.tilt.status === 'ready') {
        const rotation = last.tilt.scan.rows[last.tilt.scan.order[0]!]!.rotation;
        detected.current = { unitId: unit.id, profile, rotation };
        turnTo(unit.id, last.tilt.scan.rows[last.tilt.index]!.rotation);
      }
      return;
    }
    const token = ++scanSeq.current;
    const total = tiltCount(profile);
    setTilt({ status: 'scanning', unitId: unit.id, done: 0, total });
    const { settings, structure } = alignerSettings(unit, profile);
    const stale = () => scanSeq.current !== token || sceneRef.current.activeUnitId !== unit.id;
    void analysis().dentalTiltScan(`dental-tilt:${unit.id}`, unit.source, profile,
      { neckLengthMm: settings.neckLength, pillarDiameterMm: settings.pillarDiameter, liftMm: settings.liftHeight, braced: structure.treeEnabled || structure.bracesEnabled },
      { key: 'Scanning print angles on {name}', vars: { name: unit.name } },
      (fraction) => { if (!stale() && tiltRef.current?.status === 'scanning') setTilt({ status: 'scanning', unitId: unit.id, done: Math.round(fraction * total), total }); },
    ).then((scan) => {
      if (stale()) return;
      if (!scan || scan.kind !== 'scan') return setTilt({ status: 'failed', unitId: unit.id, reason: scan?.reason ?? 'failed' });
      const index = scan.order[0]!;
      const ready: DentalTiltState = { status: 'ready', unitId: unit.id, scan, index, hand: false, confirming: false };
      scanned.current = { unitId: unit.id, profile, source: unit.source, tilt: ready };
      setTilt(ready);
      const rotation = scan.rows[index]!.rotation;
      detected.current = { unitId: unit.id, profile, rotation };
      turnTo(unit.id, rotation);
    }, () => { if (!stale()) setTilt({ status: 'failed', unitId: unit.id, reason: 'failed' }); });
  }, [analysis, sceneRef, setTilt, turnTo]);

  /** The Step 1 slider: the row at `index`, chosen by hand; the preview turns to its pose. */
  const chooseTilt = useCallback((index: number) => {
    const current = tiltRef.current;
    if (current?.status !== 'ready' || current.confirming || !current.scan.rows[index]) return;
    keepTilt({ ...current, index, hand: index !== current.scan.order[0] });
    turnTo(current.unitId, current.scan.rows[index]!.rotation);
  }, [keepTilt, turnTo]);

  /** Step 1: mesh check, orientation and type check of the aligner, in the analysis worker; the result lands in the session. */
  const startAligner = useCallback((unit: PrintUnit) => {
    const token = ++orientSeq.current;
    const profile = sessionRef.current.dentalProfile;
    send({ type: 'dentalLoading', unitId: unit.id });
    const stale = () => orientSeq.current !== token || sessionRef.current.dentalAligner !== 'loading' || sceneRef.current.activeUnitId !== unit.id;
    const failed = (notices: readonly DentalNotice[]) => send({ type: 'dentalOrientFailed', notices });
    if (!profile) return failed([{ kind: 'failed' }]);
    detected.current = { unitId: unit.id, profile, rotation: undefined };
    void analysis().dentalOrient(`dental-orient:${unit.id}`, unit.source, profile, { key: 'Orienting {name}', vars: { name: unit.name } }).then((result) => {
      if (stale()) return;
      if (!result) return failed([{ kind: 'failed' }]);
      const notices: DentalNotice[] = result.meshOk ? [] : [{ kind: 'holes' }];
      if (result.kind === 'failed') return failed([...notices, { kind: 'failed' }]);
      // Whether the opening fits the chosen type is the profile's call, made in Rust.
      if (!result.matchesProfile) notices.push({ kind: 'mismatch' });
      detected.current = { unitId: unit.id, profile, rotation: result.rotation };
      const current = sceneRef.current.units.find((candidate) => candidate.id === unit.id);
      // Every aligner of the session is laid out again without overlap: the turn changed this one's footprint.
      const turned = result.rotation && current ? { ...current, transform: { ...current.transform, rotation: result.rotation } } : undefined;
      if (!turned) notices.push({ kind: 'uncertain' });
      const units = sceneRef.current.units.map((candidate) => (turned && candidate.id === unit.id ? turned : candidate));
      const commands = [...(turned ? [{ type: 'transform/set' as const, unitId: unit.id, transform: turned.transform }] : []), ...arrangeAlignerCommands(units, [...sessionRef.current.dentalFinished, unit.id])];
      if (commands.length > 0) dispatch({ type: 'batch', commands });
      setGizmoMode('rotate');
      requestView('fit');
      send({ type: 'dentalOriented', proposal: result.proposal, notices });
      // The print-angle search needs the aligner's own frame (an arch front).
      const oriented = sceneRef.current.units.find((candidate) => candidate.id === unit.id);
      if (turned && oriented) startScan(oriented, profile);
      else setTilt(undefined);
    }, () => { if (!stale()) failed([{ kind: 'failed' }]); });
  }, [analysis, dispatch, requestView, send, sceneRef, sessionRef, setGizmoMode, setTilt, startScan]);

  // Step 1 offered another aligner type (mismatch notice): orient the same aligner again with it.
  const { mode, dentalStage, dentalAligner, dentalProfile, dentalUnitId } = session;
  useEffect(() => {
    if (mode !== 'dental' || dentalStage !== 'aligner' || dentalAligner !== 'loading' || !dentalUnitId || !dentalProfile) return;
    const last = detected.current;
    if (!last || last.unitId !== dentalUnitId || last.profile === dentalProfile) return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === dentalUnitId);
    if (unit) startAligner(unit);
  }, [mode, dentalStage, dentalAligner, dentalProfile, dentalUnitId, sceneRef, startAligner]);

  /** "Use detected": restore the pose Step 1 found. */
  const useDetected = useCallback(() => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === sceneRef.current.activeUnitId);
    if (!unit || !sessionRef.current.dentalProposal || sessionRef.current.dentalStage !== 'aligner') return;
    const rotation = detected.current?.unitId === unit.id ? detected.current.rotation : undefined;
    if (!rotation) return setStatus('Auto orientation is uncertain. Adjust the aligner with the rotation gizmo.');
    dispatch({ type: 'transform/set', unitId: unit.id, transform: { ...unit.transform, rotation } });
    // The slider follows: back to the automatic pick.
    const current = tiltRef.current;
    if (current?.status === 'ready' && current.unitId === unit.id) keepTilt({ ...current, index: current.scan.order[0]!, hand: false });
  }, [dispatch, sceneRef, sessionRef, setStatus, keepTilt]);

  /** Step 1 Next: detect the support area for the chosen type, or open Step 2 empty for painting. */
  const next = useCallback(() => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === sceneRef.current.activeUnitId);
    const { dentalProposal: proposal, dentalProfile: profile } = sessionRef.current;
    if (!unit || sessionRef.current.dentalStage !== 'aligner' || sessionRef.current.dentalAligner !== 'ready') return;
    // Orientation failed: there is no opening to build the support area from.
    if (!proposal || !profile) return setStatus('No aligner opening was found, so no support area can be proposed. Go Back and choose another file, or Exit.');
    const detection = ++detectionSeq.current;
    setStatus('Detecting the two dental contours and support area…');
    void analysis().dentalRegion(`dental-region:${unit.id}`, unit.source, profile,
      { key: 'Detecting dental support area on {name}', vars: { name: unitName(unit.id) } }).then((region) => {
      if (detectionSeq.current !== detection ||
        sceneRef.current.units.find((candidate) => candidate.id === unit.id) !== unit ||
        sessionRef.current.dentalStage !== 'aligner' || sessionRef.current.dentalProposal !== proposal) return;
      if (!region || region.kind !== 'proposal') {
        // No area detected: Step 2 opens empty, with its message; Next stays off until something is marked.
        // Owner decision: paint may create the area from scratch, only because detection found none.
        dispatch({ type: 'batch', commands: [...presetCommands(unit, profile), { type: 'dental/set', unitId: unit.id, policy: manualAreaPolicy(proposal.rim, false, profile) }] });
        send({ type: 'acceptDentalOrientation', noArea: true });
        requestView('bottom');
        return;
      }
      // A new aligner (or one whose type changed) starts from its type's Step 3 settings and
      // Tree/Brace switches; once set, the operator's own choices are kept.
      const { settings, structure } = alignerSettings(unit, profile);
      const policy = { kind: 'two-contour' as const, profileId: profile, rim: proposal.rim, region, stamps: [], tuning: defaultDentalTuning(profile), structure };
      const accept = (angleMovedDeg?: number) => {
        dispatch({ type: 'batch', commands: [...presetCommands(unit, profile), { type: 'dental/set', unitId: unit.id, policy }] });
        send({ type: 'acceptDentalOrientation', ...(angleMovedDeg === undefined ? {} : { angleMovedDeg }) });
        requestView('bottom');
      };
      // The print-angle confirm: the automatic pick is built for real; a hand-chosen tilt is kept as chosen.
      const current = tiltRef.current;
      if (current?.status !== 'ready' || current.unitId !== unit.id || current.hand) return accept();
      const { scan } = current;
      const from = scan.order.indexOf(current.index);
      const order = scan.order.slice(Math.max(0, from));
      keepTilt({ ...current, confirming: true });
      setStatus('Checking the print angle…');
      const settled = (confirmed: number | undefined) => {
        const latest = tiltRef.current;
        if (latest?.status === 'ready' && latest.unitId === unit.id) keepTilt({ ...latest, confirming: false });
        if (detectionSeq.current !== detection || sessionRef.current.dentalStage !== 'aligner') return false;
        if (confirmed === undefined || order[confirmed] === current.index) return true;
        const index = order[confirmed]!;
        keepTilt({ ...current, index, confirming: false });
        turnTo(unit.id, scan.rows[index]!.rotation);
        return true;
      };
      void analysis().dentalConfirmTilt(`dental-confirm:${unit.id}`, { mesh: unit.source, dental: policy, settings, labelText: 'A' },
        order.map((index) => scan.rows[index]!.rotation), { key: 'Checking the print angle of {name}', vars: { name: unitName(unit.id) } }).then((result) => {
        const confirmed = result?.confirmed;
        if (!settled(confirmed)) return;
        const moved = confirmed !== undefined && confirmed > 0 ? Number(tiltLabel(scan.rows[order[confirmed]!]!.tiltDeg)) : undefined;
        accept(moved);
      }, () => { if (settled(undefined)) accept(); });
    }, () => { if (detectionSeq.current === detection) setStatus('Dental contour detection failed. No support area was approved.'); });
  }, [analysis, dispatch, keepTilt, requestView, send, sceneRef, sessionRef, setStatus, turnTo, unitName]);

  /** Exit: whatever Step 1 or Step 2 still reads or detects is dropped. */
  const invalidate = useCallback(() => {
    orientSeq.current += 1;
    detectionSeq.current += 1;
    scanSeq.current += 1;
    // A scan cut short is not kept: the aligner is scanned again when Step 1 sees it next.
    if (tiltRef.current?.status === 'scanning') setTilt(undefined);
  }, [setTilt]);

  return { startAligner, useDetected, next, invalidate, tilt, chooseTilt };
}
