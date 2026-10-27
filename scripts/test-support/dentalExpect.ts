import { cross, dot, length, normalize, subtract, type Vector } from '../../src/core/vec3';
import type { DentalRim } from '../../src/core/analysis/dental';

/*
 * Small pure helpers for dental tests and the disposable orientation probe (kept when the TS oracle was removed:
 * the production detector lives in Rust, these only express an expectation).
 */

/** The shortest Euler XYZ rotation that maps an accepted cavity opening to plate-down. */
export function rotationToPlateDown(openingDirection: Vector): Vector {
  if (!Number.isFinite(openingDirection[0]) || !Number.isFinite(openingDirection[1]) || !Number.isFinite(openingDirection[2]) || length(openingDirection) === 0) {
    throw new RangeError('openingDirection must be a finite non-zero vector');
  }
  const from = normalize(openingDirection);
  const to: Vector = [0, -1, 0];
  const alignment = Math.max(-1, Math.min(1, dot(from, to)));
  if (alignment > 1 - 1e-12) return [0, 0, 0];
  let axis = cross(from, to);
  let w = 1 + alignment;
  if (w < 1e-10) {
    axis = Math.abs(from[0]) < 0.9 ? normalize(cross(from, [1, 0, 0])) : normalize(cross(from, [0, 0, 1]));
    w = 0;
  }
  const size = Math.hypot(axis[0], axis[1], axis[2], w);
  const [x, y, z] = axis.map((value) => value / size) as Vector;
  const qw = w / size;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * qw);
  const m13 = 2 * (x * z + y * qw);
  const m23 = 2 * (y * z - x * qw);
  const m33 = 1 - 2 * (x * x + y * y);
  return [
    Math.atan2(-m23, m33),
    Math.asin(Math.max(-1, Math.min(1, m13))),
    Math.atan2(-m12, m11),
  ];
}

/**
 * Experimental aligner preset calibrated to the owner-approved, already-correct reference pose.

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
