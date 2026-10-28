import type { SupportProblem } from '../core/analysis/supportCheck';
import type { PlacementResult } from '../core/analysis/types';
import type { CheckJob, DentalPlacementJob, PlacementJob } from '../core/jobs';
import type { TriangleMesh } from '../core/analysis/types';
import type { DentalRegionProposal } from '../core/analysis/dentalRegion';
import type { DentalTuning } from '../core/analysis/dentalTuning';
import type { DentalOrientation } from '../core/analysis/dentalOrient';
import type { TiltScan, TiltScanSettings } from '../core/analysis/dentalTilt';
import type { DentalBuildInput } from '../dental/confirmTilt';
import type { Vector } from '../core/vec3';

/** One analysis job: automatic placement or a support check (the mesh arrives as a transferred copy). */
export type AnalysisTask =
  | { kind: 'place'; job: PlacementJob }
  | { kind: 'dental-place'; job: DentalPlacementJob }
  | { kind: 'dental-orient'; job: { mesh: TriangleMesh; profile: string } }
  | { kind: 'dental-region'; job: { mesh: TriangleMesh; profile: string } }
  /** Step 2/3 tuning: the strip retuned and the contacts placed on it, in one job (one worker round trip). */
  | { kind: 'dental-retune-place'; job: DentalPlacementJob & { tuning: DentalTuning } }
  /** Step 1: the print-angle search, once per file (progress: tilts done / total). */
  | { kind: 'dental-tilt-scan'; job: { mesh: TriangleMesh; profile: string; settings: TiltScanSettings } }
  /** Step 1 Next: the automatic pick's confirm builds, the pick then the next tilts in pick order. */
  | { kind: 'dental-confirm-tilt'; job: DentalBuildInput & { rotations: Vector[] } }
  | { kind: 'check'; job: CheckJob };

export type AnalysisResult =
  | { kind: 'placed'; result: PlacementResult }
  | { kind: 'dental-placed'; result: PlacementResult }
  | { kind: 'dental-orient-result'; orientation: DentalOrientation }
  | { kind: 'dental-region-result'; region: DentalRegionProposal }
  /** `placement` is the placement on the retuned region (absent when the retune found none). */
  | { kind: 'dental-retuned'; region: DentalRegionProposal; placement?: PlacementResult }
  | { kind: 'dental-tilt-scanned'; scan: TiltScan }
  | { kind: 'dental-tilt-confirmed'; confirmed: number | undefined; tried: number }
  | { kind: 'checked'; problems: SupportProblem[] };
