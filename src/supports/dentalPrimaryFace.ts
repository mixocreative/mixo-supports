import type { DiagnosticContourContact } from '../core/analysis/dentalContourContacts';
import { dot, type Vector } from '../core/vec3';

const POSITION_TOLERANCE_MM = 0.03;
const NORMAL_DOT_MINIMUM = 0.95;

/** Preserve the placement/final-build match threshold for a face-anchored dental tip. */
export function sameDentalPrimary(contact: { position: Vector; normal: Vector },
  candidate: DiagnosticContourContact): boolean {
  const dx = candidate.position[0] - contact.position[0];
  const dy = candidate.position[1] - contact.position[1];
  const dz = candidate.position[2] - contact.position[2];
  return dx * dx + dy * dy + dz * dz < POSITION_TOLERANCE_MM ** 2 &&
    dot(candidate.normal, contact.normal) > NORMAL_DOT_MINIMUM;
}

/** Exact source-face identity for an accepted dental primary contact, or undefined on ambiguity. */
export function dentalPrimarySourceFace(contact: { position: Vector; normal: Vector },
  candidates: readonly DiagnosticContourContact[]): number | undefined {
  let face: number | undefined;
  for (const candidate of candidates) {
    if (!sameDentalPrimary(contact, candidate)) continue;
    if (!Number.isInteger(candidate.face) || candidate.face < 0 ||
      (face !== undefined && face !== candidate.face)) return undefined;
    face = candidate.face;
  }
  return face;
}
