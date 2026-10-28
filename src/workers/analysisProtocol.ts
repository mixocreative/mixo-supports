import type { SupportProblem } from '../core/analysis/supportCheck';
import type { PlacementResult } from '../core/analysis/types';
import type { CheckJob, DentalPlacementJob, PlacementJob } from '../core/jobs';
import type { TriangleMesh } from '../core/analysis/types';
import type { DentalRegionProposal } from '../core/analysis/dentalRegion';
import type { DentalTuning } from '../core/analysis/dentalTuning';
import type { DentalOrientation } from '../core/analysis/dentalOrient';

/** One analysis job: automatic placement or a support check (the mesh arrives as a transferred copy). */
export type AnalysisTask =
  | { kind: 'place'; job: PlacementJob }
  | { kind: 'dental-place'; job: DentalPlacementJob }
  | { kind: 'dental-orient'; job: { mesh: TriangleMesh; profile: string } }
  | { kind: 'dental-region'; job: { mesh: TriangleMesh; profile: string } }
  /** Step 2/3 tuning: the strip retuned and the contacts placed on it, in one job (one worker round trip). */
  | { kind: 'dental-retune-place'; job: DentalPlacementJob & { tuning: DentalTuning } }
  | { kind: 'check'; job: CheckJob };

export type AnalysisResult =
  | { kind: 'placed'; result: PlacementResult }
  | { kind: 'dental-placed'; result: PlacementResult }
  | { kind: 'dental-orient-result'; orientation: DentalOrientation }
  | { kind: 'dental-region-result'; region: DentalRegionProposal }
  /** `placement` is the placement on the retuned region (absent when the retune found none). */
  | { kind: 'dental-retuned'; region: DentalRegionProposal; placement?: PlacementResult }
  | { kind: 'checked'; problems: SupportProblem[] };
