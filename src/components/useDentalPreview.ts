import { useEffect, useState } from 'react';
import type { PlacementResult, SupportPoint } from '../core/analysis/types';
import type { PrintUnit } from '../state/project';
import { dentalPlacementJobOf, orientationOf, placedPoints, resolveSettings } from '../supports/unitSupports';
import type { FinishedPlacement } from '../supports/landing';
import type { AnalysisClient } from '../workers/analysisClient';
import { seededDentalPlacement } from './dentalPlacementSeed';

/** Placement plus the exact unit/policy version it reviewed; Step 3 must consume this result. */
export interface DentalTipPreview extends FinishedPlacement {
  unit: PrintUnit;
  localPoints: readonly SupportPoint[];
  /** Every suggested tip, painted or not (where Add snaps), unit-local. */
  localSuggested: readonly SupportPoint[];
}

export function currentDentalPreview(unit: PrintUnit | undefined, preview: DentalTipPreview | undefined): DentalTipPreview | undefined {
  return unit && preview?.unit === unit ? preview : undefined;
}

export type DentalPreviewState =
  | { kind: 'idle' }
  | { kind: 'loading'; unit: PrintUnit }
  | { kind: 'ready'; unit: PrintUnit; preview: DentalTipPreview }
  | { kind: 'error'; unit: PrintUnit };

/** Debounced placement preview: worker result (or the one a retune made with the policy), never a support mesh or raft. */
export function useDentalPreview(unit: PrintUnit | undefined, active: boolean, analysis: () => AnalysisClient, unitName: (unitId: string) => string): DentalPreviewState {
  const [stored, setStored] = useState<DentalPreviewState>({ kind: 'idle' });
  useEffect(() => {
    if (!active || !unit?.dental) { setStored({ kind: 'idle' }); return; }
    const job = dentalPlacementJobOf(unit);
    if (!job) { setStored({ kind: 'error', unit }); return; }
    const ready = (result: PlacementResult) => {
      const orientation = orientationOf(unit);
      setStored({ kind: 'ready', unit, preview: {
        unit, unitId: unit.id, orientation, settings: resolveSettings(unit.settings), result,
        localPoints: placedPoints(orientation, result),
        localSuggested: placedPoints(orientation, { points: result.suggested ?? [] }),
      } });
    };
    // A retune placed the contacts for this very policy already: shown at once, no second job.
    const seeded = seededDentalPlacement(unit);
    if (seeded) { ready(seeded); return; }
    let live = true;
    let client: AnalysisClient | undefined;
    const key = `dental-preview:${unit.id}`;
    setStored({ kind: 'loading', unit });
    const timer = window.setTimeout(() => {
      client = analysis();
      void client.dentalPlace(key, job, { key: 'Placing dental contacts on {name}', vars: { name: unitName(unit.id) } }).then((result) => {
        if (!live) return;
        if (!result) { setStored({ kind: 'error', unit }); return; }
        ready(result);
      }, () => { if (live) setStored({ kind: 'error', unit }); });
    }, 180);
    return () => { live = false; window.clearTimeout(timer); client?.cancel(key); };
  }, [unit, active, analysis, unitName]);
  if (!active || !unit) return { kind: 'idle' };
  return stored.kind !== 'idle' && stored.unit === unit ? stored : { kind: 'loading', unit };
}
