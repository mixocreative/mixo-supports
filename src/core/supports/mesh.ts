import type { TriangleMesh } from '../analysis/types';
import type { DentalRimCoverage } from '../analysis/dentalRimCoverage';
import type { Vector } from '../vec3';
import type { ShapeOverride } from './settings';

/*
 * Types of the support mesh the build produces and the host consumes. The builder itself is the
 * Rust `build_supports` (`src/supports/rustSupports.ts`); the TypeScript builder it replaced is kept as a test reference in
 * scripts/test-support (tests only).
 */

export type Point2 = [number, number];

/** A support contact in build-plate space: Y is up and the plate is y = 0 (mm). */
export interface SupportContact {
  id: string;
  /** Manual contacts never merge into Auto Tree branches and ignore zones. Unset means automatic. */
  origin?: 'auto' | 'manual';
  position: Vector;
  /** Model surface normal at the contact, pointing out of the model. */
  normal: Vector;
  /** Exact indexed model face at the primary tip, when placement can certify it. */
  sourceFace?: number;
  /**
   * SLASG point class. With a model, `face` and `edge` contacts take their neck normal from
   * the voxel remesh (nearest face / nearest edge) and `vertical` ones point straight down;
   * without a class the given normal is used as is.
   */
  kind?: 'face' | 'edge' | 'vertical';
  /** The support's own tip, contact, neck and foot values over the object's settings; such a support never joins a tree. */
  shape?: ShapeOverride;
}

export type SupportPart =
  | 'tip' | 'neck' | 'pillar' | 'foot' | 'brace' | 'raft'
  | 'tree-branch' | 'tree-trunk'
  | 'roof' | 'column' | 'roof-brace' | 'cross-bar' | 'cage-ring'
  | 'label';

/** Source-model contacts a built component intentionally approaches; not a collision exemption. */
export type ContactIntent =
  | { kind: 'primary'; contactId: string; point: Vector; normal: Vector; faceIndex?: number }
  | { kind: 'secondary'; point: Vector; normal: Vector; faceIndex?: number };

export interface SupportComponent {
  part: SupportPart;
  /** Marks a neck split from an Auto Tree branch rather than an ordinary pillar. */
  structureKind?: 'tree';
  /** Owning contact for picking; structural parts (raft, braces, roof...) have none. */
  contactId?: string;
  /** First index into `indices`, and the number of indices (a multiple of 3). */
  start: number;
  count: number;
  /**
   * A pillar that lands on the model with its landing tip built into the tube (round tapered tip,
   * no sphere): its last `landingReach` mm, around the tube's end, show in the tips view.
   */
  landingReach?: number;
  /** Requires a separate face-local, depth-bounded collision classifier before use. */
  contactIntent?: ContactIntent[];
}

export interface GeneratedSupportMesh extends TriangleMesh {
  parts: SupportPart[];
  components: SupportComponent[];
  /** Automatic contacts this build left out because a secondary landing was forbidden. */
  dropped: string[];
  /** Subset of dropped contacts rejected specifically by a no-support zone. */
  droppedByZones?: string[];
  /** Automatic columns omitted by an explicit pre-build route decision, when enabled. */
  droppedByPath?: string[];
  /** Final built contacts on each dental rim; absent when the detector could not certify a contour. */
  dentalRimCoverage?: DentalRimCoverage;
  /** Requested dental structures omitted because their built geometry crossed the model. */
  dentalStructureFallback?: Array<'tree' | 'brace'>;
}
