export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Region {
  id: number;
  faceIndices: number[];
}
