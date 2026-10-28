import { useCallback, useEffect, useRef, useState } from 'react';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { DentalTuning } from '../core/analysis/dentalTuning';
import type { PlacementResult } from '../core/analysis/types';
import { defaultDentalTuning } from '../dental/tuning';
import { profileData } from '../dental/alignerProfiles';
import type { PrintUnit, SceneCommand } from '../state/project';
import { dentalPlacementJobOf } from '../supports/unitSupports';
import type { AnalysisClient } from '../workers/analysisClient';
import { seedDentalPlacement } from './dentalPlacementSeed';

type Draft = { unitId: string; tuning: DentalTuning };

/**
 * The retuned policy and the placement on it, for the unit as the retune saw it. True: the host
 * applied both (Step 3 lands the contacts with the policy in one batch); false: the hook stores the
 * policy and the Step 2 preview shows the placement.
 */
export type ApplyRetune = (unit: PrintUnit, policy: DentalPolicy, placement: PlacementResult | undefined) => boolean;

/**
 * Debounced worker retune: the visible controls move immediately; stale proposals never enter the
 * scene. One debounce and one worker job retune the strip and place its contacts together.
 */
export function useDentalTuning(unit: PrintUnit | undefined, active: boolean, analysis: () => AnalysisClient,
  dispatch: (command: SceneCommand) => void, unitName: (unitId: string) => string, apply?: ApplyRetune) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState(false);
  const policy = unit?.dental;
  const busy = active && draft?.unitId === unit?.id;
  // The aligner type's own defaults and slider limits (profile data).
  const tuning = busy && draft ? draft.tuning : policy ? (policy.kind === 'two-contour' ? policy.tuning : undefined) ?? defaultDentalTuning(policy.profileId) : undefined;
  const limits = policy ? profileData(policy.profileId).defaults : undefined;
  const change = useCallback((next: DentalTuning) => {
    if (!active || !unit || unit.dental?.kind !== 'two-contour') return;
    setError(false);
    setDraft({ unitId: unit.id, tuning: next });
  }, [active, unit]);

  useEffect(() => {
    if (!active || draft?.unitId !== unit?.id) setDraft(null);
  }, [active, draft?.unitId, unit?.id]);

  useEffect(() => {
    if (!busy || !unit || policy?.kind !== 'two-contour' || !draft) return;
    let live = true;
    let client: AnalysisClient | undefined;
    const key = `dental-retune:${unit.id}`;
    const job = dentalPlacementJobOf(unit)!;
    const timer = window.setTimeout(() => {
      client = analysis();
      void client.retunePlaceDental(key, job, draft.tuning,
        { key: 'Updating dental support area on {name}', vars: { name: unitName(unit.id) } }).then((retuned) => {
        if (!live) return;
        if (retuned?.region.kind !== 'proposal') { setDraft(null); setError(true); return; }
        const next: DentalPolicy = { ...policy, tuning: draft.tuning, region: retuned.region };
        if (retuned.placement) seedDentalPlacement(unit, next, job.orientation.rotation, retuned.placement);
        if (!applyRef.current?.(unit, next, retuned.placement)) dispatch({ type: 'dental/set', unitId: unit.id, policy: next });
        setDraft(null);
      }, () => { if (live) { setDraft(null); setError(true); } });
    }, 180);
    return () => { live = false; window.clearTimeout(timer); client?.cancel(key); };
  }, [analysis, busy, dispatch, draft, policy, unit, unitName]);
  return { tuning, limits, busy, error, change };
}
