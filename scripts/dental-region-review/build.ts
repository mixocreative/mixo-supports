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
import { scanDentalTilts, type TiltScan } from '../../src/core/analysis/dentalTilt';
import { confirmPick } from '../../src/dental/confirmTilt';
import type { Vector } from '../../src/core/vec3';

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

/** The aligner type's Step 3 settings and switches, as the app gives a new aligner. */
function appSettings() {
  return { ...dentalSupportSettings(REFERENCE_PROFILE, defaultSupportSettings), roofSeededModes: [] };
}

export type PrintAngle =
  | { kind: 'angle'; scan: Extract<TiltScan, { kind: 'scan' }>; index: number; rotation: Vector; confirmed: boolean; tried: number }
  | { kind: 'inconclusive'; reason: string };

/**
 * The app's Step 1 print angle: the scan with the new aligner's settings, then the confirm builds
 * of the automatic pick (the pick, then at most two more tilts in pick order).
 */
export function pickPrintAngle(mesh: TriangleMesh): PrintAngle {
  const settings = appSettings();
  const structure = dentalStructureOf(REFERENCE_PROFILE);
  const scan = scanDentalTilts(mesh, REFERENCE_PROFILE, { neckLengthMm: settings.neckLength, pillarDiameterMm: settings.pillarDiameter,
    liftMm: settings.liftHeight, braced: structure.treeEnabled || structure.bracesEnabled });
  if (scan.kind !== 'scan') return { kind: 'inconclusive', reason: `tilt-scan-${scan.reason}` };
  const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
  const orientation = proposeDentalOrientation(mesh, REFERENCE_PROFILE);
  const pick = scan.order[0]!;
  if (region.kind !== 'proposal' || orientation.kind !== 'proposal') return { kind: 'angle', scan, index: pick, rotation: scan.rows[pick]!.rotation, confirmed: false, tried: 0 };
  const dental = { kind: 'two-contour' as const, profileId: REFERENCE_PROFILE, rim: orientation.rim, region, stamps: [], structure };
  const { confirmed, tried } = confirmPick({ mesh, dental, settings, labelText: 'A' }, scan.order.map((index) => scan.rows[index]!.rotation));
  const index = confirmed === undefined ? pick : scan.order[confirmed]!;
  return { kind: 'angle', scan, index, rotation: scan.rows[index]!.rotation, confirmed: confirmed !== undefined, tried };
}

/**
 * Runs the same detector, dental placement filter, and support builder used by the app, at the
 * profile's pose or at `poseRotation` (Euler XYZ, e.g. the print angle `pickPrintAngle` chose).
 */
export function buildDentalReview(mesh: TriangleMesh, poseRotation?: Vector): DentalReviewBuild {
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
  const rotation = poseRotation ?? rotationToDentalPose(mesh, orientation.rim, REFERENCE_PROFILE);
  if (!rotation) return { kind: 'inconclusive', reason: 'dental-pose-inconclusive' };

  const settings = appSettings();
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
