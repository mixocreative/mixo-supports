import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proposeDentalOrientation, rotationToDentalPose } from '../core/analysis/dental';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { TriangleMesh } from '../core/analysis/types';
import type { JobTransform } from '../core/jobs';
import { defaultSupportSettings } from '../core/supports/settings';
import type { Vector } from '../core/vec3';
import { inverseTransformDirection, inverseTransformPoint, transformedMinY } from '../state/transform';
import { placeGeneric } from '../supports/genericPlacement';
import { runSupportJob } from '../supports/jobRunner';
import { applyTransform } from '../state/transform';
import { dentalPolicyOf } from '../../scripts/test-support/dentalPolicyOf';
import { REFERENCE_PROFILE } from '../../scripts/test-support/referenceProfile';
import { parseStl } from '../../scripts/test-support/rustImport';
import { manualAreaFaces, manualAreaPolicy } from './manualArea';
import { filterDentalPlacement } from './placement';

/*
 * Regression (owner bug): an area painted from scratch (no area detected) used to send a policy that
 * matched automatic contacts against an empty candidate list, so every automatic contact of the fill
 * was left out, and it had no landing rule. Rust `dental_policy` now permits the area's own fill
 * contacts and keeps secondary landings on the painted faces.
 */

const settings = { overhangAngleDegrees: 45, spacing: 2, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false };

/** Distance from `p` to triangle `face` of `mesh`. */
function distanceToFace(mesh: TriangleMesh, face: number, p: Vector): number {
  const v = (k: number) => { const i = mesh.indices[face * 3 + k]! * 3; return [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!]; };
  const [a, b, c] = [v(0), v(1), v(2)] as [number[], number[], number[]];
  const sub = (x: number[], y: number[]) => [x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!];
  const dot = (x: number[], y: number[]) => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
  // Closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5).
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q: number[];
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = b;
    else if (d6 >= 0 && d5 <= d6) q = c;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); q = a.map((x, i) => x + t * ab[i]!); }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); q = a.map((x, i) => x + t * ac[i]!); }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + d5 - d6); q = b.map((x, i) => x + t * (c[i]! - x)); }
    else { const denom = 1 / (va + vb + vc); const s = vb * denom, t = vc * denom; q = a.map((x, i) => x + s * ab[i]! + t * ac[i]!); }
  }
  const d = sub(p, q);
  return Math.sqrt(dot(d, d));
}

describe('an area painted from scratch on the reference aligner', () => {
  it('builds automatic supports, every one on a painted face, with landings kept on the paint', () => {
    const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
    const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const orientation = proposeDentalOrientation(mesh, REFERENCE_PROFILE);
    if (orientation.kind !== 'proposal') throw new Error('reference orientation');
    const rotation = rotationToDentalPose(mesh, orientation.rim)!;
    const turn: JobTransform = { position: [0, 0, 0], rotation };
    // Treat it as an aligner whose area was not detected: Step 2 paints one from scratch.
    const centre = Array.from(orientation.rim.points.subarray(0, 3)) as Vector;
    const stamps: DentalPolicy['stamps'] = [{ center: centre, radius: 25, normal: orientation.rim.openingDirection, kind: 'allow' }];
    const painted: DentalPolicy = { ...manualAreaPolicy(orientation.rim, false, REFERENCE_PROFILE), stamps };

    // The policy Rust makes: the paint is the area, its own contacts are permitted, landings stay on it.
    const policy = dentalPolicyOf(mesh, painted);
    const paintedFaces = manualAreaFaces(mesh, stamps, false, REFERENCE_PROFILE);
    expect(policy.automatic).toBe(0);
    expect(policy.landingRule).toBe(1);
    expect(policy.islandsOutside).toBe(true);
    expect(Array.from(policy.permittedFaces)).toEqual(Array.from(paintedFaces));

    // Step 2 placement (turned frame) mapped back to the unit, then Step 3 Generate.
    const placed = filterDentalPlacement({ mesh, orientation: turn, settings, dental: painted }, placeGeneric(applyTransform(mesh, turn), settings));
    expect(placed.points.length).toBeGreaterThan(0);
    const points = placed.points.map((p) => ({ ...p, position: inverseTransformPoint(turn, p.position), normal: inverseTransformDirection(turn, p.normal) }));
    const frame: JobTransform = { position: [0, defaultSupportSettings.liftHeight - transformedMinY(mesh.positions, turn), 0], rotation };
    const built = runSupportJob({ mesh, frame, settings: defaultSupportSettings, dental: painted, labelText: 'A', mode: 'preview',
      contacts: { points, manual: [], deleted: [], zones: [], contactSettings: {} } });
    const builtIds = new Set(built.components.filter((c) => c.contactId).map((c) => c.contactId!));
    expect(builtIds.size).toBeGreaterThan(0);
    // Before the fix every automatic contact of the painted area was left out.
    expect(built.dropped).toEqual([]);
    expect(builtIds.size).toBe(points.length);

    // Every built automatic contact stands on a painted face.
    const faces = [...paintedFaces.keys()].filter((face) => paintedFaces[face] === 1);
    for (const p of points.filter((p) => builtIds.has(p.id))) {
      const nearest = Math.min(...faces.map((face) => distanceToFace(mesh, face, p.position)));
      expect(nearest, `${p.id} on a painted face`).toBeLessThan(1e-3);
    }
  }, 300_000);
});
