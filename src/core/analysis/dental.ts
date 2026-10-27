import { dot, subtract, type Vector } from '../vec3';
import { DEFAULT_PROFILE_ID } from './dentalProfile';
import { dentalEngine, rimOf, rimScalars } from './dentalEngine';
import type { TriangleMesh } from './types';

export interface DentalRim {
  /** Only a paired lower-edge loop may authorize automatic dental supports. */
  boundaryKind: 'lower-edge-loop' | 'projection-fallback';
  /** Unit-local closed loop. The first point is not repeated. */
  points: Float32Array;
  /** Unit-local direction from the tooth cavity through its opening. */
  openingDirection: Vector;
  centroid: Vector;
  tangent: Vector;
  bitangent: Vector;
  /** Orthographic visibility of the cavity opening in the local rim frame. */
  visibilityMask: Uint8Array;
  visibilityResolution: number;
  visibilityMin: [number, number];
  visibilityMax: [number, number];
}

export interface DentalDiagnostics {
  confidence: number;
  terminalAreaRatio: number;
  axialVarianceRatio: number;
}

export type DentalProposal =
  | { kind: 'proposal'; rim: DentalRim; diagnostics: DentalDiagnostics }
  | { kind: 'inconclusive'; reason: 'invalid-mesh' | 'no-cavity' | 'ambiguous-cavity'; diagnostics: DentalDiagnostics };

/**
 * Finds a candidate cavity opening from a thick shell (Rust `propose_dental_orientation`).
 * Returned geometry is unit-local.
 */
export function proposeDentalOrientation(mesh: TriangleMesh, profile: string = DEFAULT_PROFILE_ID): DentalProposal {
  const result = dentalEngine().propose_dental_orientation(mesh.positions, mesh.indices, profile);
  try {
    const [confidence, terminalAreaRatio, axialVarianceRatio] = result.diagnostics();
    const diagnostics: DentalDiagnostics = { confidence: confidence ?? 0, terminalAreaRatio: terminalAreaRatio ?? 0, axialVarianceRatio: axialVarianceRatio ?? 0 };
    if (result.status() !== 0) return { kind: 'inconclusive', reason: result.reason() as 'invalid-mesh' | 'no-cavity' | 'ambiguous-cavity', diagnostics };
    return { kind: 'proposal', rim: rimOf(result), diagnostics };
  } finally {
    result.free();
  }
}

/**
 * Experimental aligner preset calibrated to the owner-approved, already-correct reference pose
 * (Rust `dental_pose`). Returns undefined for ambiguous arches. A convenience proposal, not a
 * universal clinical print orientation.
 */
export function rotationToDentalPose(mesh: TriangleMesh, rim: DentalRim): Vector | undefined {
  const pose = dentalEngine().dental_pose(mesh.positions, mesh.indices, rimScalars(rim));
  return pose.length === 3 ? [pose[0]!, pose[1]!, pose[2]!] : undefined;
}

/** Whether a unit-local point projects into the detected cavity visibility footprint. */
export function rimContainsPoint(rim: DentalRim, point: Vector): boolean {
  const delta = subtract(point, rim.centroid);
  const u = dot(delta, rim.tangent);
  const v = dot(delta, rim.bitangent);
  const width = rim.visibilityMax[0] - rim.visibilityMin[0];
  const height = rim.visibilityMax[1] - rim.visibilityMin[1];
  if (!(width > 0) || !(height > 0)) return false;
  const x = Math.floor(((u - rim.visibilityMin[0]) / width) * rim.visibilityResolution);
  const y = Math.floor(((v - rim.visibilityMin[1]) / height) * rim.visibilityResolution);
  if (x < 0 || x >= rim.visibilityResolution || y < 0 || y >= rim.visibilityResolution) return false;
  return rim.visibilityMask[y * rim.visibilityResolution + x] === 1;
}

/**
 * Exact first-surface queries along the accepted cavity opening. This deliberately keeps the
 * mesh transient: only the approved footprint belongs in project state. A visible point is not
 * automatically a support-eligible point; final policy still needs a trustworthy trim boundary.
 */
export class DentalOpeningRaycaster {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly mesh: TriangleMesh, private readonly rim: DentalRim) {
    const { visibilityResolution: resolution } = rim;
    for (let face = 0; face < mesh.indices.length / 3; face += 1) {
      const triangle = [0, 1, 2].map((corner) => pointAt(mesh, mesh.indices[face * 3 + corner]!)) as [Vector, Vector, Vector];
      const projected = triangle.map((point) => this.project(point));
      const xs = projected.map(([u]) => this.cell(u, 0));
      const ys = projected.map(([, v]) => this.cell(v, 1));
      const minX = Math.max(0, Math.min(...xs));
      const maxX = Math.min(resolution - 1, Math.max(...xs));
      const minY = Math.max(0, Math.min(...ys));
      const maxY = Math.min(resolution - 1, Math.max(...ys));
      if (minX > maxX || minY > maxY) continue;
      for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
        const key = y * resolution + x;
        const faces = this.cells.get(key);
        if (faces) faces.push(face); else this.cells.set(key, [face]);
      }
    }
  }

  /** True only when point is the first mesh surface hit from outside the accepted opening. */
  visible(point: Vector): boolean {
    if (!rimContainsPoint(this.rim, point)) return false;
    const [u, v, depth] = this.project(point);
    const x = this.cell(u, 0);
    const y = this.cell(v, 1);
    const faces = this.cells.get(y * this.rim.visibilityResolution + x);
    if (!faces) return false;
    let firstDepth = -Infinity;
    for (const face of faces) {
      const [a, b, c] = [0, 1, 2].map((corner) => this.project(pointAt(this.mesh, this.mesh.indices[face * 3 + corner]!))) as [[number, number, number], [number, number, number], [number, number, number]];
      const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(denominator) < 1e-12) continue;
      const l1 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / denominator;
      const l2 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / denominator;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) continue;
      firstDepth = Math.max(firstDepth, l1 * a[2] + l2 * b[2] + l3 * c[2]);
    }
    return Number.isFinite(firstDepth) && Math.abs(depth - firstDepth) <= 1e-3;
  }

  private project(point: Vector): [number, number, number] {
    const delta = subtract(point, this.rim.centroid);
    return [dot(delta, this.rim.tangent), dot(delta, this.rim.bitangent), dot(delta, this.rim.openingDirection)];
  }

  private cell(value: number, axis: 0 | 1): number {
    const min = this.rim.visibilityMin[axis];
    const span = this.rim.visibilityMax[axis] - min;
    return Math.floor(((value - min) / span) * this.rim.visibilityResolution);
  }
}

function pointAt(mesh: TriangleMesh, index: number): Vector {
  const offset = index * 3;
  return [mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!];
}
