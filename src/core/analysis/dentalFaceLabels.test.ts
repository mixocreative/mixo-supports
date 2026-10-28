import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import labelData from '../../../docs/dental-reference/face-labels.json';
import { buildLabels } from '../../../scripts/test-support/dentalFaceLabels';
import { parseStl } from '../../../scripts/test-support/rustImport';
import { dentalPolicyOf } from '../../../scripts/test-support/dentalPolicyOf';
import type { DentalPolicy } from './dentalPolicy';
import { proposeDentalSupportRegion } from './dentalRegion';
import { REFERENCE_PROFILE, footprintSettings, fromBelow, referenceTuning } from '../../../scripts/test-support/referenceProfile';
import { proposeDentalContactFootprint } from './dentalContactFootprint';

/** Face labels of the reference aligner (docs/dental-reference/face-labels.json): tips and secondary landings on allowed faces only. */
interface Labels { faceCount: number; forbiddenFaceRuns: number[]; allowedFaceRuns: number[] }
const labels = labelData as Labels;

const expand = (runs: readonly number[], count: number): Uint8Array => {
  const mask = new Uint8Array(count);
  for (let at = 0; at < runs.length; at += 2) mask.fill(1, runs[at]!, runs[at]! + runs[at + 1]!);
  return mask;
};

describe('reference aligner face labels', () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const forbidden = expand(labels.forbiddenFaceRuns, labels.faceCount);
  const allowed = expand(labels.allowedFaceRuns, labels.faceCount);
  const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);

  it('are the labels the detector produces now (regenerate with scripts/dental-face-labels.ts)', () => {
    expect(labels.faceCount).toBe(mesh.indices.length / 3);
    expect(buildLabels()).toEqual(expect.objectContaining({ faceCount: labels.faceCount,
      forbiddenFaceRuns: labels.forbiddenFaceRuns, allowedFaceRuns: labels.allowedFaceRuns }));
  }, 60000);

  it('keep allowed and forbidden faces disjoint and the strip narrow', () => {
    for (let face = 0; face < labels.faceCount; face += 1) expect(allowed[face]! & forbidden[face]!).toBe(0);
    const strip = allowed.reduce((sum, face) => sum + face, 0);
    expect(strip).toBeGreaterThan(0);
    expect(strip).toBeLessThan(labels.faceCount / 10);
  });

  const saved = (stamps: DentalPolicy['stamps'] = []): DentalPolicy => {
    if (region.kind !== 'proposal') throw new Error('reference region');
    return { kind: 'two-contour', profileId: REFERENCE_PROFILE, region, rim: { boundaryKind: 'projection-fallback', points: new Float32Array(),
      openingDirection: [0, 1, 0], centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array(),
      visibilityResolution: 0, visibilityMin: [0, 0], visibilityMax: [0, 0] }, stamps };
  };

  // A tip off the area was moved there because a support could not reach its own face from below
  // (`footprint::Facing`): it faces down at least as far as the profile asks and stays within the
  // move distance of the area (3D bound to the nearest contour vertex, plus one opening edge of slack).
  const { low, high } = footprintSettings();
  const rule = fromBelow();
  const contourPoints = (() => {
    if (region.kind !== 'proposal') return [];
    return [...region.outerEdges, ...region.openingEdges].map((v) => [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!]);
  })();
  const fromEdge = (p: readonly number[]) => Math.min(...contourPoints.map((q) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!)));
  const expectOnAreaOrMovedFromBelow = (tip: { face: number; position: number[]; normal: number[] }) => {
    if (allowed[tip.face] === 1) return 0;
    expect(tip.normal[1], `moved tip on face ${tip.face} faces down`).toBeLessThanOrEqual(rule.maxUp + 1e-9);
    expect(fromEdge(tip.position), `moved tip on face ${tip.face}`).toBeLessThanOrEqual((forbidden[tip.face] ? -low : high) + rule.moveMm + 0.3);
    return 1;
  };

  it('put every tip the policy builds on an allowed face, or moved from it where a support reaches it from below', () => {
    expect(region.kind).toBe('proposal');
    if (region.kind !== 'proposal') return;
    const policy = dentalPolicyOf(mesh, saved());
    const footprint = proposeDentalContactFootprint(mesh, region, { ...footprintSettings(), fromBelow: rule });
    if (footprint.kind !== 'proposal') throw new Error(footprint.reason);
    expect(policy.candidates.length).toBe(footprint.outerContacts.length + footprint.innerContacts.length);
    expect(policy.candidates.length).toBeGreaterThan(70);
    const moved = policy.candidates.reduce((sum, tip) => sum + expectOnAreaOrMovedFromBelow(tip), 0);
    // The reference's up-facing stretch of the opening rim: its tips move just across the edge.
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(policy.candidates.length / 4);
  }, 60000);

  it('put every repair alternate (a half-step sample) on an allowed face, or moved from it like a tip', () => {
    const { alternates } = dentalPolicyOf(mesh, saved());
    expect(alternates.length).toBeGreaterThan(70);
    for (const alternate of alternates) expectOnAreaOrMovedFromBelow(alternate);
  }, 60000);

  it('keep detected tips off the forbidden side under paint; only painted faces join the area', () => {
    // Paint is the operator's own choice and may reach any face (owner decision, unit B); the detected
    // tips and their alternates still never go onto the fitting side, except the move to a face a
    // support reaches from below, which paint does not change.
    const stamp = { center: [0, 0, 0] as [number, number, number], radius: 1e6, normal: [0, 0, 1] as [number, number, number], kind: 'allow' as const };
    const policy = dentalPolicyOf(mesh, saved([stamp]));
    const detected = policy.candidates.filter((c) => !c.id.startsWith('dental-fill-'));
    const plain = dentalPolicyOf(mesh, saved());
    const movedFaces = new Set([...plain.candidates, ...plain.alternates].filter((c) => forbidden[c.face] === 1).map((c) => c.face));
    for (const face of [...detected, ...policy.alternates].map((c) => c.face)) expect(forbidden[face] === 0 || movedFaces.has(face), `face ${face}`).toBe(true);
    const painted = policy.candidates.filter((c) => c.id.startsWith('dental-fill-'));
    expect(painted.length).toBeGreaterThan(0);
    for (const { face } of painted) expect(policy.permittedFaces[face], `paint tip on face ${face}`).toBe(1);
    // An erase stamp after it takes the paint, and the detected tips under it (faces turned the same way), away again.
    const erased = dentalPolicyOf(mesh, saved([stamp, { ...stamp, kind: 'erase' }]));
    expect(erased.candidates.filter((c) => c.id.startsWith('dental-fill-'))).toEqual([]);
    expect(erased.candidates.length).toBeGreaterThan(0);
    expect(erased.candidates.length).toBeLessThan(detected.length);
  }, 120000);
});
