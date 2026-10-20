export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Region {
  id: number;
  faceIndices: number[];
}

export type SupportPointSource = 'interior' | 'physical-boundary' | 'sharp-ridge' | 'island';

export interface SupportPoint {
  id: string;
  regionId: number;
  position: [number, number, number];
  normal: [number, number, number];
  source: SupportPointSource;
}

export interface PlacementSettings {
  overhangAngleDegrees: number;
  spacing: number;
  edgeInset: number;
  sharpEdgeAngleDegrees: number;
  includeIslands: boolean;
  /** Blender "Downward Faces"; defaults to true. */
  includeDownward?: boolean;
  /** Blender "Reinforce Overhang Edges"; defaults to true. */
  reinforceEdges?: boolean;
}

export interface PlacementResult {
  points: SupportPoint[];
  regions: Region[];
  contactPositions: Float32Array;
  contactNormals: Float32Array;
}

export interface PlacementWorkerRequest {
  jobId: number;
  unitId: string;
  revision: number;
  mesh: TriangleMesh;
  settings: PlacementSettings;
}

export interface PlacementWorkerResponse {
  kind: 'result';
  jobId: number;
  unitId: string;
  revision: number;
  result: PlacementResult;
}

/** Sent while a placement job runs: `fraction` in [0, 1] and the current stage. */
export interface PlacementWorkerProgress {
  kind: 'progress';
  jobId: number;
  unitId: string;
  revision: number;
  fraction: number;
  stage: string;
}

/** Reports how far a long job has come: `fraction` in [0, 1] and a short stage name. */
export type ProgressCallback = (fraction: number, stage: string) => void;
