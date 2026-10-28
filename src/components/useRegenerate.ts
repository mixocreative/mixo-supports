import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { assertGenerateMemory, refusalLimit } from '../core/budget';
import { errorStatus } from '../editing/errors';
import { landedStatus, RegenerateQueue, regeneratingStatus } from '../editing/regenerate';
import type { EditMode, StatusMessage } from '../editing/types';
import type { UndoAction } from '../editing/toast';
import type { Message } from '../i18n';
import { memoryInfo } from '../state/runtime';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { PlacementResult } from '../core/analysis/types';
import type { PrintScene, PrintUnit, SceneCommand } from '../state/project';
import { landPlacements, type FinishedPlacement } from '../supports/landing';
import { dentalPlacementJobOf, orientationOf, placementJobOf, resolveSettings } from '../supports/unitSupports';
import type { AnalysisClient } from '../workers/analysisClient';
import type { DentalTipPreview } from './useDentalPreview';
import { codedJobError } from '../workers/jobErrors';
import { isAbort, RUNTIME, triangleCount, type SetStatus } from './appShared';

/**
 * Placement of automatic contacts: Generate and Regenerate, the placement-setting changes that
 * regenerate by themselves outside a mode, and what lands. Objects placed together land in one
 * history step, so the one Undo toast covers them all.
 */
export function useRegenerate(host: {
  sceneRef: MutableRefObject<PrintScene>;
  mode: EditMode;
  targets: (scene: PrintScene) => PrintUnit[];
  analysis: () => AnalysisClient;
  unitName: (unitId: string) => string;
  dispatch: (command: SceneCommand) => void;
  offerUndo: (action: UndoAction) => void;
  setStatus: SetStatus;
  setStatusMessage: (message: Message) => void;
}) {
  const { sceneRef, mode, targets, analysis, unitName, dispatch, offerUndo, setStatus, setStatusMessage } = host;
  const placing = useRef(new Set<string>());
  /** A placement job is running (the registry's Generate waits for it). */
  const [generating, setGenerating] = useState(false);

  /** A unit left the scene: its placement is no longer waited for. */
  const forgetPlacing = useCallback((unitId: string) => {
    placing.current.delete(unitId);
    setGenerating(placing.current.size > 0);
  }, []);

  /** `cause`: a placement setting changed (the status says so), else the Generate or Regenerate button. */
  const generate = useCallback((unitIds?: readonly string[], cause: 'button' | 'placement' = 'button') => {
    const current = sceneRef.current;
    const units = unitIds ? current.units.filter((unit) => unitIds.includes(unit.id)) : targets(current);
    if (units.length === 0) return setStatus('Import a model before generating supports.');
    // The job gate runs at most the refusal limit's triangles at once; refuse when even that
    // could not fit in half the memory a small device reports (deviceMemory under 8; 8 is clamped).
    const triangles = units.reduce((sum, unit) => sum + triangleCount(unit), 0);
    try {
      assertGenerateMemory(Math.min(triangles, refusalLimit(RUNTIME)), RUNTIME, memoryInfo().deviceMemoryGb);
    } catch (error) {
      return setStatusMessage(errorStatus('place', codedJobError(error)));
    }
    let failure: StatusMessage | undefined;
    const finished = units.map((unit) => {
      // Placement runs on the rotated but untranslated model (placementJobOf) so moving a unit
      // never shifts the sampling lattice; automatic IDs (and removals) stay stable.
      const settings = resolveSettings(unit.settings);
      const orientation = orientationOf(unit);
      placing.current.add(unit.id);
      setGenerating(true);
      // A dental aligner places on its accepted area (Step 2); anything else on its overhangs.
      const dentalJob = dentalPlacementJobOf(unit);
      const placed = dentalJob
        ? analysis().dentalPlace(`place:${unit.id}`, dentalJob, { key: 'Placing dental contacts on {name}', vars: { name: unitName(unit.id) } })
        : analysis().place(`place:${unit.id}`, placementJobOf(unit), { key: 'Placing contacts on {name}', vars: { name: unitName(unit.id) } });
      return placed.then((result): FinishedPlacement | undefined => {
        forgetPlacing(unit.id);
        return result ? { unitId: unit.id, orientation, settings, result } : undefined; // no result: replaced by a newer request for this unit
      }, (error: unknown) => {
        forgetPlacing(unit.id);
        failure = isAbort(error) ? { key: 'Support placement cancelled; existing supports kept.' } : errorStatus('place', codedJobError(error), { name: unit.name });
        return undefined;
      });
    });
    // Objects placed together land together: one history step, so one Undo covers them all.
    void Promise.all(finished).then((results) => {
      const { commands, landed, again } = landPlacements(sceneRef.current.units, results.filter((entry) => entry !== undefined));
      // A rotation made meanwhile turned the contacts away: place again for the new orientation.
      if (again.length > 0) {
        generate(again.map((unit) => unit.id), cause);
        setStatus('{name} was rotated while its contacts were placed: placing them again.', { name: again[0]!.name });
      }
      if (landed.length > 0) {
        dispatch({ type: 'batch', commands });
        // A regeneration says what it did to hand work, and Undo brings the old supports back.
        const message = landedStatus(landed);
        setStatusMessage(message);
        if (landed.every((entry) => entry.report)) offerUndo({ kind: 'regenerate', message });
      }
      if (failure) setStatusMessage(failure);
    });
    if (units.every((unit) => unit.supports)) setStatusMessage(regeneratingStatus({ n: units.length, name: units[0]!.name }, cause));
    else setStatus('Analysing overhangs for 1 object.', { n: units.length }, 'Analysing overhangs for {n} objects.');
  }, [analysis, dispatch, forgetPlacing, offerUndo, sceneRef, setStatus, setStatusMessage, targets, unitName]);

  /** Step 3 consumes exactly the Step 2 worker result, never a divergent second placement. */
  const generateDental = useCallback((reviewed: DentalTipPreview): boolean => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === reviewed.unitId);
    if (unit !== reviewed.unit || reviewed.result.points.length === 0) return false;
    const { commands, landed, again } = landPlacements(sceneRef.current.units, [reviewed]);
    if (again.length > 0 || landed.length === 0) return false;
    dispatch({ type: 'batch', commands });
    const message = landedStatus(landed);
    setStatusMessage(message);
    if (landed.every((entry) => entry.report)) offerUndo({ kind: 'regenerate', message });
    return true;
  }, [dispatch, offerUndo, sceneRef, setStatusMessage]);

  /**
   * A Step 3 retune (density): the new policy and the placement the same worker job made on it land
   * in one batch, so the supports are rebuilt once. False when the unit was rotated or removed since.
   */
  const landRetuned = useCallback((asked: PrintUnit, policy: DentalPolicy, result: PlacementResult): boolean => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === asked.id);
    if (!unit) return false;
    const finished: FinishedPlacement = { unitId: unit.id, orientation: orientationOf(asked), settings: resolveSettings(unit.settings), result };
    const { commands, landed, again } = landPlacements(sceneRef.current.units, [finished]);
    if (again.length > 0 || landed.length === 0) return false;
    dispatch({ type: 'batch', commands: [{ type: 'dental/set', unitId: unit.id, policy }, ...commands] });
    const message = landedStatus(landed);
    setStatusMessage(message);
    if (landed.every((entry) => entry.report)) offerUndo({ kind: 'regenerate', message });
    return true;
  }, [dispatch, offerUndo, sceneRef, setStatusMessage]);

  const generateRef = useRef(generate);
  generateRef.current = generate;
  /** A placement change is waiting out its burst: the pending note holds back, the regeneration is on its way. */
  const [queued, setQueued] = useState(false);
  const queue = useRef<RegenerateQueue>();
  queue.current ??= new RegenerateQueue((ids) => {
    const live = ids.filter((id) => sceneRef.current.units.find((unit) => unit.id === id)?.supports);
    if (live.length > 0) generateRef.current(live, 'placement');
  }, setQueued);
  const scheduleRegenerate = useCallback((unitIds: string[]) => queue.current!.schedule(unitIds), []);
  // A mode takes the supports over: a regeneration still queued for a change made before it does not run behind it.
  useEffect(() => {
    if (mode !== 'off') queue.current!.cancel();
  }, [mode]);
  useEffect(() => () => queue.current!.cancel(), []);

  return { generate, generateDental, landRetuned, generating, regenQueued: queued, scheduleRegenerate, forgetPlacing };
}
