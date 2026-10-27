import type { TriangleMesh } from '../../core/analysis/types';
import { geometryNow, type GeometryEngine } from '../../workers/geometryClient';

type OverlayEngine = Pick<GeometryEngine, 'dental_face_overlay' | 'dental_contour_segments'>;

const ready = (engine: OverlayEngine | undefined): OverlayEngine => {
  if (!engine) throw new Error('Geometry engine is not ready: await geometryReady() before building overlays');
  return engine;
};

/** A separate vertex per approved triangle corner; forbidden adjacent faces get no overlay. Rust `dental_face_overlay`. */
export function dentalFaceOverlay(mesh: TriangleMesh, allowedFaces: Uint8Array, engine: OverlayEngine | undefined = geometryNow()): { positions: Float32Array; normals: Float32Array } {
  const result = ready(engine).dental_face_overlay(mesh.positions, mesh.indices, allowedFaces);
  try {
    return { positions: result.take_positions(), normals: result.take_normals() };
  } finally {
    result.free();
  }
}

/** Each pair names one actual mesh edge; no flat-plane or interpolated contour is introduced. Rust `dental_contour_segments`. */
export function dentalContourSegments(mesh: TriangleMesh, pairs: Uint32Array, engine: OverlayEngine | undefined = geometryNow()): Float32Array {
  return ready(engine).dental_contour_segments(mesh.positions, pairs);
}
