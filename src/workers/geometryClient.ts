import initWasm, { AsciiStlSession, BinaryStlSession, body_segments, build_pick_index, center_positions_in_place, decimate_display, dental_allowed_vertices, dental_contour_segments, dental_face_overlay, live_mesh_handles, engine_version, GeometrySession, invert_matrix, placement_matrix, refine_for_overlay, transform_positions, transform_vectors, transformed_min_y, vertex_normals, weld_positions_in_place, generic_policy_contacts, position_ids, remap_deleted_ids, hiding_removal_ids, contacts_hidden_by_marker_ids, rekey_contact_ids, rekey_hand_work, check_support_problems } from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm.js';
import wasmUrl from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm_bg.wasm?url';
import { setDentalEngine } from '../core/analysis/dentalEngine';
import { setTransformEngine } from '../state/transformEngine';
import { setSupportEngine } from '../supports/supportEngine';
import { assertGeometryVersion } from './geometryVersion';

export interface GeometryEngine {
  engine_version(): number;
  GeometrySession: typeof GeometrySession;
  center_positions_in_place: typeof center_positions_in_place;
  weld_positions_in_place: typeof weld_positions_in_place;
  decimate_display: typeof decimate_display;
  BinaryStlSession: typeof BinaryStlSession;
  AsciiStlSession: typeof AsciiStlSession;
  /* U2 core spatial calls (see the ABI table in docs/SHIP-PLAN.md); GeometrySession also has transform / pick / pick_pixels / project_brush. */
  body_segments: typeof body_segments;
  /* Pick index built outside a session (import worker), loaded by GeometrySession.load_mesh_indexed. */
  build_pick_index: typeof build_pick_index;
  dental_allowed_vertices: typeof dental_allowed_vertices;
  /* Mesh handles alive in this module instance (lifecycle tests: a finished or cancelled job leaves 0). */
  live_mesh_handles: typeof live_mesh_handles;
  dental_contour_segments: typeof dental_contour_segments;
  dental_face_overlay: typeof dental_face_overlay;
  invert_matrix: typeof invert_matrix;
  placement_matrix: typeof placement_matrix;
  refine_for_overlay: typeof refine_for_overlay;
  transform_positions: typeof transform_positions;
  transform_vectors: typeof transform_vectors;
  transformed_min_y: typeof transformed_min_y;
  vertex_normals: typeof vertex_normals;
  /* U5 generic policy and manual-edit bookkeeping (supports/genericPolicy, supports/contactEdits). */
  generic_policy_contacts: typeof generic_policy_contacts;
  position_ids: typeof position_ids;
  remap_deleted_ids: typeof remap_deleted_ids;
  hiding_removal_ids: typeof hiding_removal_ids;
  contacts_hidden_by_marker_ids: typeof contacts_hidden_by_marker_ids;
  rekey_contact_ids: typeof rekey_contact_ids;
  rekey_hand_work: typeof rekey_hand_work;
  /* Dental and the U7 safety engine are GeometrySession methods (orient_dental, propose/retune_dental_region, dental_policy, dental_legacy_fill, generic_policy, load_placed, generate, diagnose); the dental internals exist only in the Node test package (`test-abi`). The support check below. A missing entry here breaks the walk, not the unit tests. */
  check_support_problems: typeof check_support_problems;
}

let ready: Promise<GeometryEngine> | undefined;
let loaded: GeometryEngine | undefined;

/**
 * The engine once `geometryReady()` has resolved in this realm, else undefined. For synchronous
 * interactive code (brush, pick, gizmo maths) that cannot await; the app entry awaits
 * `geometryReady()` before it renders, and each worker awaits it before its first task.
 */
export function geometryNow(): GeometryEngine | undefined {
  return loaded;
}

/** Mesh bytes the shared main-thread session may hold (picked, brushed and overlaid models). */
const SHARED_SESSION_BYTES = 0x20000000;
let shared: GeometrySession | undefined;

/**
 * The main thread's session for meshes the viewport picks against (pointer rays, the brush's
 * occluders). Undefined until `geometryReady()` has resolved. Same package and engine_version as
 * every worker's instance.
 */
export function sharedSession(): GeometrySession | undefined {
  if (!loaded) return undefined;
  return (shared ??= new loaded.GeometrySession(SHARED_SESSION_BYTES));
}

/** One WASM instance per realm (each worker and the main thread); reject a mismatched package before geometry is used. */
export function geometryReady(): Promise<GeometryEngine> {
  ready ??= initWasm({ module_or_path: wasmUrl }).then(() => {
    assertGeometryVersion(engine_version());
    loaded = { engine_version, GeometrySession, center_positions_in_place, weld_positions_in_place, decimate_display, BinaryStlSession, AsciiStlSession, body_segments, build_pick_index, dental_allowed_vertices, dental_contour_segments, dental_face_overlay, live_mesh_handles, invert_matrix, placement_matrix, refine_for_overlay, transform_positions, transform_vectors, transformed_min_y, vertex_normals, generic_policy_contacts, position_ids, remap_deleted_ids, hiding_removal_ids, contacts_hidden_by_marker_ids, rekey_contact_ids, rekey_hand_work, check_support_problems };
    setTransformEngine(loaded);
    setSupportEngine(loaded);
    setDentalEngine(loaded);
    return loaded;
  });
  return ready;
}
