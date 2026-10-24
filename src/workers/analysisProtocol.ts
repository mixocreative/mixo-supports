import type { SupportProblem } from '../core/analysis/supportCheck';
import type { PlacementResult } from '../core/analysis/types';
import type { CheckJob, DentalPlacementJob, PlacementJob } from '../core/jobs';

/** One analysis job: automatic placement or a support check (the mesh arrives as a transferred copy). */
export type AnalysisTask =
  | { kind: 'place'; job: PlacementJob }
  | { kind: 'dental-place'; job: DentalPlacementJob }
  | { kind: 'check'; job: CheckJob };

export type AnalysisResult =
  | { kind: 'placed'; result: PlacementResult }
  | { kind: 'dental-placed'; result: PlacementResult }
  | { kind: 'checked'; problems: SupportProblem[] };
