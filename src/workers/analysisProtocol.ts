import type { SupportProblem } from '../core/analysis/supportCheck';
import type { PlacementResult } from '../core/analysis/types';
import type { CheckJob, DentalPlacementJob, PlacementJob } from '../core/jobs';
import type { TriangleMesh } from '../core/analysis/types';
import type { DentalRegionProposal } from '../core/analysis/dentalRegion';
import type { DentalTuning } from '../core/analysis/dentalTuning';

/** One analysis job: automatic placement or a support check (the mesh arrives as a transferred copy). */
export type AnalysisTask =
  | { kind: 'place'; job: PlacementJob }
  | { kind: 'dental-place'; job: DentalPlacementJob }
  | { kind: 'dental-region'; job: { mesh: TriangleMesh } }
  | { kind: 'dental-retune'; job: { mesh: TriangleMesh;
    region: Extract<DentalRegionProposal, { kind: 'proposal' }>; tuning: DentalTuning } }
  | { kind: 'check'; job: CheckJob };

export type AnalysisResult =
  | { kind: 'placed'; result: PlacementResult }
  | { kind: 'dental-placed'; result: PlacementResult }
  | { kind: 'dental-region-result'; region: DentalRegionProposal }
  | { kind: 'checked'; problems: SupportProblem[] };
