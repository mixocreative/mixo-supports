import '../test-support/useNodeEngine';
import { proposeDentalOrientation, rotationToDentalPose } from '../../src/core/analysis/dental';
import { proposeDentalSupportRegion, type DentalRegionProposal } from '../../src/core/analysis/dentalRegion';
import { diagnosticDentalSideBands, type DentalDiagnosticBands } from '../../src/core/analysis/dentalContactBand';
import { sampleDiagnosticContourContacts, type DiagnosticContourContact } from '../../src/core/analysis/dentalContourContacts';
import type { PlacementResult, TriangleMesh } from '../../src/core/analysis/types';
import type { JobTransform } from '../../src/core/jobs';
import type { GeneratedSupportMesh } from '../../src/core/supports/mesh';
import { defaultSupportSettings, toPlacementSettings } from '../../src/core/supports/settings';
import { filterDentalPlacement, runSupportJob } from '../../src/supports/jobRunner';
import { applyTransform, inverseTransformDirection, inverseTransformPoint } from '../../src/state/transform';

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
  const region = proposeDentalSupportRegion(mesh);
  if (region.kind !== 'proposal') return region;
  const bands = diagnosticDentalSideBands(mesh, region, { setback: 0.2, width: 1.2 });
  if (bands.kind !== 'proposal') return { kind: 'inconclusive', reason: `diagnostic-band-${bands.reason}` };
  const outer = sampleDiagnosticContourContacts(mesh, region.outerEdges, bands.outerOtherSide,
    { spacing: 2, maxSearchDistance: 1.5 });
  const inner = sampleDiagnosticContourContacts(mesh, region.openingEdges, bands.innerOtherSide,
    { spacing: 2, maxSearchDistance: 1.5 });
  if (outer.kind !== 'proposal' || inner.kind !== 'proposal') {
    return { kind: 'inconclusive', reason: `diagnostic-contact-${outer.kind !== 'proposal' ? outer.reason : inner.kind !== 'proposal' ? inner.reason : 'unknown'}` };
  }
  const orientation = proposeDentalOrientation(mesh);
  if (orientation.kind !== 'proposal') return { kind: 'inconclusive', reason: `orientation-${orientation.reason}` };
  const rotation = rotationToDentalPose(mesh, orientation.rim);
  if (!rotation) return { kind: 'inconclusive', reason: 'dental-pose-inconclusive' };

  const orientationOnly: JobTransform = { position: [0, 0, 0], rotation };
  const turned = applyTransform(mesh, orientationOnly);
  let lowestY = Infinity;
  for (let at = 1; at < turned.positions.length; at += 3) lowestY = Math.min(lowestY, turned.positions[at]!);
  if (!Number.isFinite(lowestY)) return { kind: 'inconclusive', reason: 'empty-or-invalid-mesh' };
  const frame: JobTransform = {
    position: [0, defaultSupportSettings.liftHeight - lowestY, 0], rotation,
  };
  const dental = { kind: 'two-contour' as const, rim: orientation.rim, region, stamps: [] };
  const empty: PlacementResult = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
  const placement = filterDentalPlacement({ mesh, orientation: orientationOnly,
    settings: toPlacementSettings(defaultSupportSettings), dental }, empty);
  if (placement.points.length === 0) return { kind: 'inconclusive', reason: 'no-proposed-dental-tips' };
  const localPoints = placement.points.map((point) => ({ ...point,
    position: inverseTransformPoint(orientationOnly, point.position),
    normal: inverseTransformDirection(orientationOnly, point.normal),
  }));
  const supports = runSupportJob({ mesh, dental, frame, settings: { ...defaultSupportSettings, roofSeededModes: [] },
    contacts: { points: localPoints, manual: [], deleted: [], zones: [], contactSettings: {} },
    labelText: 'A', mode: 'export' });
  return { kind: 'proposal', region, bands, diagnosticContacts: { outer, inner }, frame, placement, supports };
}
