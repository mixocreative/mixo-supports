import type { TriangleMesh } from './types';
import type { DentalRegionProposal } from './dentalRegion';
import { dentalEngine } from './dentalEngine';

type Region = Extract<DentalRegionProposal, { kind: 'proposal' }>;
export type DentalDiagnosticBands = { kind: 'proposal'; outerOpeningSide: Uint8Array; outerOtherSide: Uint8Array;
  innerOpeningSide: Uint8Array; innerOtherSide: Uint8Array };
type BandResult = DentalDiagnosticBands | { kind: 'inconclusive'; reason: string };

/**
 * Diagnostic strips on both sides of each curve (Rust `dental_side_bands`). Uses the old face cut
 * only to label sides for inspection; it does not determine which side is non-fitting or allow
 * contacts.
 */
export function diagnosticDentalSideBands(mesh: TriangleMesh, region: Region,
  settings: { setback: number; width: number }): BandResult {
  const result = dentalEngine().dental_side_bands(mesh.positions, mesh.indices, region.allowedFaces, region.outerEdges,
    region.openingEdges, settings.setback, settings.width);
  try {
    if (!result.ok()) return { kind: 'inconclusive', reason: result.reason() };
    return { kind: 'proposal', outerOpeningSide: result.take_band(0), outerOtherSide: result.take_band(1),
      innerOpeningSide: result.take_band(2), innerOtherSide: result.take_band(3) };
  } finally {
    result.free();
  }
}
