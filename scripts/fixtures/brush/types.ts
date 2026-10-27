/** Shape of aligner-brush.json: the recorded camera + pointer fixture for the Rust pick / screen-brush parity tests (U2).
 * The JSON is itself the recording (made once by the TS oracle: three.js camera + three-mesh-bvh + screenBrush);
 * the generator was retired with the oracle in U9. */

export interface BrushCase {
  name: string;
  /** Model world matrix (the model's local frame is the mesh's own). */
  modelWorld: number[];
  /** Support group world matrix (same as the model for a real unit; offset in the last case). */
  supportWorld: number[];
  /** projection * view * supportWorld: support-local to clip. */
  clip: number[];
  /** inverse(projection * view * modelWorld): clip to model-local, for pixel picks. */
  clipToModel: number[];
  /** inverse(modelWorld) * supportWorld. */
  supportToModel: number[];
  /** Camera position in support-local space. */
  eye: number[];
  pixels: number[];
  /** Face id of the first model hit under each pixel, -1 for none (three.js camera ray + MeshBVH). */
  pickFaces: number[];
  strokes: { radius: number; points: number[]; slots: number[]; /** touched by the circle but hidden behind the model */ hiddenSlots: number[] }[];
}

export interface BrushFixture {
  aligner: string;
  triangles: number;
  width: number;
  height: number;
  bodies: { points: number[]; first: number[] };
  cases: BrushCase[];
}


export const ALIGNER = 'docs/dental-reference/reference-aligner.stl';
