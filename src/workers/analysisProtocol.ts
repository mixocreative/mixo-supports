import type { CheckSettings, SupportProblem } from '../core/analysis/supportCheck';
import type { PlacementResult, PlacementSettings, TriangleMesh } from '../core/analysis/types';

type Vector = [number, number, number];

/** Automatic contact placement for one unit (model already in its placement frame). */
export interface PlaceRequest {
  kind: 'place';
  jobId: number;
  mesh: TriangleMesh;
  settings: PlacementSettings;
}

/** What the contacts leave unsupported (model and contacts in the same Y-up frame). */
export interface CheckRequest {
  kind: 'check';
  jobId: number;
  mesh: TriangleMesh;
  contacts: Vector[];
  settings: CheckSettings;
}

export type AnalysisRequest = PlaceRequest | CheckRequest;

export type AnalysisResponse =
  | { kind: 'progress'; jobId: number; fraction: number; stage: string }
  | { kind: 'placed'; jobId: number; result: PlacementResult }
  | { kind: 'checked'; jobId: number; problems: SupportProblem[] }
  | { kind: 'error'; jobId: number; message: string };
