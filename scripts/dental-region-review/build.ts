import { useNodeEngine } from '../node-engine';
import { proposeDentalOrientation, rotationToDentalPose } from '../../src/core/analysis/dental';
import { proposeDentalSupportRegion, type DentalRegionProposal } from '../../src/core/analysis/dentalRegion';
import { dentalAreaBand, diagnosticDentalSideBands, type DentalDiagnosticBands } from '../../src/core/analysis/dentalContactBand';
import { profileData } from '../../src/dental/alignerProfiles';
import { sampleDiagnosticContourContacts, type DiagnosticContourContact } from '../../src/core/analysis/dentalContourContacts';
import type { PlacementResult, TriangleMesh } from '../../src/core/analysis/types';
import type { JobTransform } from '../../src/core/jobs';
import type { GeneratedSupportMesh } from '../../src/core/supports/mesh';
import { defaultSupportSettings, toPlacementSettings } from '../../src/core/supports/settings';
import { runSupportJob } from '../../src/supports/jobRunner';
import { filterDentalPlacement } from '../../src/dental/placement';
import { dentalStructureOf, dentalSupportSettings } from '../../src/dental/supportPreset';
import { applyTransform, inverseTransformDirection, inverseTransformPoint } from '../../src/state/transform';
import { REFERENCE_PROFILE, referenceTuning } from './profile';

useNodeEngine();

type Region = Extract<DentalRegionProposal, { kind: 'proposal' }>;
export type DiagnosticReviewContacts = {
  outer: { contacts: DiagnosticContourContact[]; skippedSamples: number };
  inner: { contacts: DiagnosticContourContact[]; skippedSamples: number };
};
export type DentalReviewBuild =
  | { kind: 'proposal'; region: Region; bands: DentalDiagnosticBands; diagnosticContacts: DiagnosticReviewContacts; frame: JobTransform;
    placement: PlacementResult; supports: GeneratedSupportMesh }
  | { kind: 'inconclusive'; reason: string };

/** Runs the same detector, dental placement filter, and support builder used by the app. */
export function buildDentalReview(mesh: TriangleMesh): DentalReviewBuild {
  const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
  if (region.kind !== 'proposal') return region;
  // The diagnostic strips and samples use the profile's own area and spacing (the app's defaults).
  const { defaults } = profileData(REFERENCE_PROFILE);
  const [low, high] = dentalAreaBand(referenceTuning, REFERENCE_PROFILE);
  const bands = diagnosticDentalSideBands(mesh, region, { setback: Math.max(0, low), width: high });
  if (bands.kind !== 'proposal') return { kind: 'inconclusive', reason: `diagnostic-band-${bands.reason}` };
  const outer = sampleDiagnosticContourContacts(mesh, region.outerEdges, bands.outerOtherSide,
    { spacing: defaults.outerSpacingMm / referenceTuning.density, maxSearchDistance: defaults.maxSearchMm });
  const inner = sampleDiagnosticContourContacts(mesh, region.openingEdges, bands.innerOtherSide,
    { spacing: defaults.innerSpacingMm / referenceTuning.density, maxSearchDistance: defaults.maxSearchMm });
  if (outer.kind !== 'proposal' || inner.kind !== 'proposal') {
    return { kind: 'inconclusive', reason: `diagnostic-contact-${outer.kind !== 'proposal' ? outer.reason : inner.kind !== 'proposal' ? inner.reason : 'unknown'}` };
  }
  const orientation = proposeDentalOrientation(mesh, REFERENCE_PROFILE);
  if (orientation.kind !== 'proposal') return { kind: 'inconclusive', reason: `orientation-${orientation.reason}` };
  const rotation = rotationToDentalPose(mesh, orientation.rim, REFERENCE_PROFILE);
  if (!rotation) return { kind: 'inconclusive', reason: 'dental-pose-inconclusive' };

  // The aligner type's Step 3 settings and switches, as the app gives a new aligner.
  const settings = { ...dentalSupportSettings(REFERENCE_PROFILE, defaultSupportSettings), roofSeededModes: [] };
  const orientationOnly: JobTransform = { position: [0, 0, 0], rotation };
  const turned = applyTransform(mesh, orientationOnly);
  let lowestY = Infinity;
  for (let at = 1; at < turned.positions.length; at += 3) lowestY = Math.min(lowestY, turned.positions[at]!);
  if (!Number.isFinite(lowestY)) return { kind: 'inconclusive', reason: 'empty-or-invalid-mesh' };
  const frame: JobTransform = {
    position: [0, settings.liftHeight - lowestY, 0], rotation,
  };
  const dental = { kind: 'two-contour' as const, profileId: REFERENCE_PROFILE, rim: orientation.rim, region, stamps: [], structure: dentalStructureOf(REFERENCE_PROFILE) };
  const empty: PlacementResult = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
  const placement = filterDentalPlacement({ mesh, orientation: orientationOnly,
    settings: toPlacementSettings(settings), dental }, empty);
  if (placement.points.length === 0) return { kind: 'inconclusive', reason: 'no-proposed-dental-tips' };
  const localPoints = placement.points.map((point) => ({ ...point,
    position: inverseTransformPoint(orientationOnly, point.position),
    normal: inverseTransformDirection(orientationOnly, point.normal),
  }));
  const supports = runSupportJob({ mesh, dental, frame, settings,
    contacts: { points: localPoints, manual: [], deleted: [], zones: [], contactSettings: {} },
    labelText: 'A', mode: 'export' });
  return { kind: 'proposal', region, bands, diagnosticContacts: { outer, inner }, frame, placement, supports };
}
