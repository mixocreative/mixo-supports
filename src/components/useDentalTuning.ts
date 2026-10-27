import { useCallback, useEffect, useRef, useState } from 'react';
import type { DentalTuning } from '../core/analysis/dentalTuning';
import { defaultDentalTuning } from '../dental/tuning';
import { profileData } from '../dental/alignerProfiles';
import type { PrintUnit, SceneCommand } from '../state/project';
import type { AnalysisClient } from '../workers/analysisClient';

type Draft = { unitId: string; tuning: DentalTuning };

/** Debounced worker retune: the visible controls move immediately; stale proposals never enter the scene. */
export function useDentalTuning(unit: PrintUnit | undefined, active: boolean, analysis: () => AnalysisClient,
  dispatch: (command: SceneCommand) => void, unitName: (unitId: string) => string, applied?: (unitId: string) => void) {
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
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
    const timer = window.setTimeout(() => {
      client = analysis();
      void client.retuneDentalRegion(key, unit.source, policy.region, draft.tuning, policy.profileId,
        { key: 'Updating dental support area on {name}', vars: { name: unitName(unit.id) } }).then((region) => {
        if (!live) return;
        if (region?.kind !== 'proposal') { setDraft(null); setError(true); return; }
        dispatch({ type: 'dental/set', unitId: unit.id,
          policy: { ...policy, tuning: draft.tuning, region } });
        setDraft(null);
        appliedRef.current?.(unit.id);
      }, () => { if (live) { setDraft(null); setError(true); } });
    }, 180);
    return () => { live = false; window.clearTimeout(timer); client?.cancel(key); };
  }, [analysis, busy, dispatch, draft, policy, unit, unitName]);
  return { tuning, limits, busy, error, change };
}
