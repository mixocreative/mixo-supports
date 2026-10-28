import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { defaultDentalTuning } from '../dental/tuning';
import type { Vector } from '../core/vec3';
import type { GizmoMode, ViewRequest } from './viewport/types';
import type { PrintScene, PrintUnit, SceneCommand } from '../state/project';
import type { DentalNotice, EditSession, SessionEvent } from '../editing/session';
import type { AnalysisClient } from '../workers/analysisClient';
import { arrangeAlignerCommands } from '../dental/arrange';
import { manualAreaPolicy } from '../dental/manualArea';

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

export function useDentalFlow({ analysis, dispatch, send, sceneRef, sessionRef, session, setStatus, requestView, setGizmoMode, unitName }: DentalFlowHost) {
  const orientSeq = useRef(0);
  const detectionSeq = useRef(0);
  /** The pose Step 1 found for the current proposal (`orient_dental` returns it with the rim). */
  const detected = useRef<{ unitId: string; profile: string; rotation: Vector | undefined } | undefined>(undefined);

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
    }, () => { if (!stale()) failed([{ kind: 'failed' }]); });
  }, [analysis, dispatch, requestView, send, sceneRef, sessionRef, setGizmoMode]);

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
  }, [dispatch, sceneRef, sessionRef, setStatus]);

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
        dispatch({ type: 'dental/set', unitId: unit.id, policy: manualAreaPolicy(proposal.rim, false, profile) });
        send({ type: 'acceptDentalOrientation', noArea: true });
        requestView('bottom');
        return;
      }
      dispatch({ type: 'dental/set', unitId: unit.id, policy: { kind: 'two-contour', profileId: profile, rim: proposal.rim, region, stamps: [],
        tuning: defaultDentalTuning(profile) } });
      send({ type: 'acceptDentalOrientation' });
      requestView('bottom');
    }, () => { if (detectionSeq.current === detection) setStatus('Dental contour detection failed. No support area was approved.'); });
  }, [analysis, dispatch, requestView, send, sceneRef, sessionRef, setStatus, unitName]);

  /** Exit: whatever Step 1 or Step 2 still reads or detects is dropped. */
  const invalidate = useCallback(() => {
    orientSeq.current += 1;
    detectionSeq.current += 1;
  }, []);

  return { startAligner, useDetected, next, invalidate };
}
