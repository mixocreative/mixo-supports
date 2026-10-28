import type { TriangleMesh } from '../../core/analysis/types';
import { geometryNow, type GeometryEngine } from '../../workers/geometryClient';

type OverlayEngine = Pick<GeometryEngine, 'face_mask_overlay' | 'face_mask_contour_segments'>;

const ready = (engine: OverlayEngine | undefined): OverlayEngine => {
  if (!engine) throw new Error('Geometry engine is not ready: await geometryReady() before building overlays');
  return engine;
};

/** A separate vertex per approved triangle corner; forbidden adjacent faces get no overlay. Rust `face_mask_overlay`. */
export function faceMaskOverlay(mesh: TriangleMesh, allowedFaces: Uint8Array, engine: OverlayEngine | undefined = geometryNow()): { positions: Float32Array; normals: Float32Array } {
  const result = ready(engine).face_mask_overlay(mesh.positions, mesh.indices, allowedFaces);
  try {
    return { positions: result.take_positions(), normals: result.take_normals() };
  } finally {
    result.free();
  }
}

/** Each pair names one actual mesh edge; no flat-plane or interpolated contour is introduced. Rust `face_mask_contour_segments`. */
export function faceMaskContourSegments(mesh: TriangleMesh, pairs: Uint32Array, engine: OverlayEngine | undefined = geometryNow()): Float32Array {
  return ready(engine).face_mask_contour_segments(mesh.positions, pairs);
}
