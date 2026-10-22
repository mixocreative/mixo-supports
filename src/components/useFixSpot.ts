import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { atSpot, coverRadius, recheckStatus, type FixSpot } from '../editing/check';
import { busyStatus } from '../editing/status';
import { FIX_TOOL_EVENTS, type EditSession, type SessionEvent } from '../editing/session';
import type { EditMode } from '../editing/types';
import type { Message } from '../i18n';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import type { Vector } from '../core/vec3';
import type { PrintScene, PrintUnit, SceneCommand } from '../state/project';
import { currentBuild, resolveSettings, type UnitBuild } from '../supports/unitSupports';
import type { SetStatus } from './appShared';

/** A check finding as Fix needs it: where it is in its object's frame and how large. */
export interface FixTarget { unitId: string; position: Vector; area: number }

/**
 * Fix on a check finding: frames the spot, opens Support Edit Mode on its object with the Add tool
 * waiting, and follows the support added there through to the re-check that says whether the
 * spot is covered. The spot belongs to one visit of the mode.
 */
export function useFixSpot(host: {
  sceneRef: MutableRefObject<PrintScene>;
  sessionRef: MutableRefObject<EditSession>;
  units: readonly PrintUnit[];
  activeUnitId: string | undefined;
  editMode: EditMode;
  built: ReadonlyMap<string, UnitBuild>;
  problems: ReadonlyMap<string, { unit: PrintUnit; mesh: GeneratedSupportMesh | undefined; items: readonly { position: Vector }[] }>;
  send: (event: SessionEvent) => void;
  dispatch: (command: SceneCommand) => void;
  setStatus: SetStatus;
  setStatusMessage: (message: Message) => void;
  showProblem: (problem: FixTarget) => void;
}) {
  const { sceneRef, sessionRef, units, activeUnitId, editMode, built, problems, send, dispatch, setStatus, setStatusMessage, showProblem } = host;
  /** Unit to open in Support Edit Mode once it is the active unit ("Fix" on a check finding). */
  const [editTarget, setEditTarget] = useState<{ unitId: string; spot: FixSpot }>();
  /** The spot a check finding's Fix framed: the next support added near it covers it. */
  const fixSpot = useRef<FixSpot | undefined>(undefined);
  /** A support was added at a Fix spot: its finding stays listed, marked, until the re-check says if the spot is covered. */
  const [rechecking, setRechecking] = useState<FixSpot>();

  const fix = useCallback((problem: FixTarget) => {
    showProblem(problem);
    const { mode } = sessionRef.current;
    if (mode === 'zones') return setStatusMessage(busyStatus(mode));
    const unit = sceneRef.current.units.find((candidate) => candidate.id === problem.unitId);
    if (!unit) return;
    const spot: FixSpot = { unitId: unit.id, position: problem.position, radius: coverRadius(resolveSettings(unit.settings).scatterSpacing, problem.area) };
    // Inside Support Edit Mode on the same object the spot is framed and the Add tool waits for the click.
    if (mode === 'edit' && sceneRef.current.activeUnitId === unit.id) {
      fixSpot.current = spot;
      FIX_TOOL_EVENTS.forEach(send);
      return setStatus('Click the framed spot to add a support.');
    }
    send({ type: 'leave' });
    dispatch({ type: 'selection/set', unitIds: [unit.id], activeUnitId: unit.id });
    setEditTarget({ unitId: unit.id, spot });
  }, [dispatch, sceneRef, send, sessionRef, setStatus, setStatusMessage, showProblem]);

  useEffect(() => {
    if (!editTarget || activeUnitId !== editTarget.unitId) return;
    setEditTarget(undefined);
    send({ type: 'enterEdit' });
    FIX_TOOL_EVENTS.forEach(send);
    fixSpot.current = editTarget.spot;
    setStatus('Click the framed spot to add a support.');
  }, [activeUnitId, editTarget, send, setStatus]);
  useEffect(() => { if (editMode !== 'edit') fixSpot.current = undefined; }, [editMode]);

  // The re-check that follows a support added at a Fix spot decides whether the spot is covered.
  useEffect(() => {
    if (!rechecking) return;
    const unit = units.find((candidate) => candidate.id === rechecking.unitId);
    if (!unit) return setRechecking(undefined);
    const entry = problems.get(unit.id);
    if (!entry || entry.unit !== unit || entry.mesh !== currentBuild(unit, built.get(unit.id))) return;
    setRechecking(undefined);
    setStatusMessage(recheckStatus(rechecking, entry.items));
  }, [built, problems, rechecking, setStatusMessage, units]);

  /** A support was added at `position` (the object's frame): true when it landed at the framed spot, which now waits for the re-check. */
  const noteAdded = useCallback((unitId: string, position: Vector): boolean => {
    const spot = fixSpot.current;
    if (!spot || spot.unitId !== unitId || !atSpot(position, spot)) return false;
    fixSpot.current = undefined;
    setRechecking(spot);
    setStatus('Support added near the spot. Re-checking…');
    return true;
  }, [setStatus]);

  /** Whether the finding is the one a support was just added at (it reads "re-checking"). */
  const isRechecking = useCallback((problem: { unitId: string; position: Vector }) => rechecking?.unitId === problem.unitId && atSpot(problem.position, rechecking), [rechecking]);

  const stopRechecking = useCallback(() => setRechecking(undefined), []);

  return { fix, noteAdded, isRechecking, stopRechecking };
}
