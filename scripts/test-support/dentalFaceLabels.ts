import './useNodeEngine';
// The allowed/forbidden face labels of the reference aligner (docs/dental-reference/face-labels.json),
// built from the production (Rust) detector. Regenerate with `npx vite-node scripts/dental-face-labels.ts`.
// The labels are the allowed/forbidden face sets the dental tests rely on (dentalContactBand,
// dentalPolicy, dentalContactFootprint): tips and secondary landings may sit only on `allowed`.
import { readFileSync } from 'node:fs';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import { REFERENCE_PROFILE, referenceTuning } from './referenceProfile';
import { parseStl } from './rustImport';

const fixture = 'docs/dental-reference/reference-aligner.stl';

/** Run-length encoding of the 1-faces: [start, length, start, length, ...]. */
export function runs(mask: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let face = 0; face < mask.length; face += 1) {
    if (mask[face] !== 1) continue;
    const last = out.length - 2;
    if (last >= 0 && out[last]! + out[last + 1]! === face) out[last + 1]! += 1; else out.push(face, 1);
  }
  return out;
}

export function buildLabels() {
  const bytes = readFileSync(fixture);
  const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
  if (region.kind !== 'proposal' || !region.contactFaces) throw new Error(`reference must yield a region: ${JSON.stringify(region)}`);
  return {
    fixture,
    faceCount: mesh.indices.length / 3,
    tuning: referenceTuning,
    meaning: {
      forbidden: 'Opening-facing (fitting) side of the two contours. No tip and no secondary landing may sit on it.',
      allowed: 'The detected area at the default tuning: the faces on the non-fitting side whose surface distance from a contour is within the area (position ± half the width). Every detected tip and every secondary landing must sit on it; operator paint can add faces.',
    },
    forbiddenFaceRuns: runs(region.allowedFaces),
    allowedFaceRuns: runs(region.contactFaces),
  };
}

