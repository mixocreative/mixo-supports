import type { TriangleMesh } from '../../../../src/core/analysis/types';
import type { DentalRegionProposal } from './dentalRegion';
import { diagnosticDentalSideBands } from './dentalContactBand';
import { sampleDiagnosticContourContacts, type DiagnosticContourContact } from './dentalContourContacts';

type Region = Extract<DentalRegionProposal, { kind: 'proposal' }>;

export interface DentalContactFootprintSettings {
  setback: number;
  width: number;
  outerSpacing: number;
  innerSpacing: number;
  maxSearchDistance: number;
  /** 0 samples at the contour origin; omitted keeps the usual half-spacing phase. */
  samplePhaseFraction?: number;
}

/** Current one-reference defaults; keep widths and spacing together for future validated overrides. */
export const defaultDentalContactFootprintSettings: Readonly<DentalContactFootprintSettings> = {
  setback: 0.2, width: 1.2, outerSpacing: 3, innerSpacing: 2, maxSearchDistance: 1.5,
};

export type DentalContactFootprint =
  | { kind: 'proposal'; contactFaces: Uint8Array; outerContacts: DiagnosticContourContact[];
    innerContacts: DiagnosticContourContact[] }
  | { kind: 'inconclusive'; reason: string };

/**
 * Composes the existing exact contour and local surface-strip detectors into a narrow candidate.
 * The old broad face cut is used only to distinguish the two sides of each ridge. This proposal
 * is not a production permission: contact approach, secondary landings, and body paths still
 * need to be checked before a support is built.
 */
export function proposeDentalContactFootprint(mesh: TriangleMesh, region: Region,
  settings: DentalContactFootprintSettings): DentalContactFootprint {
  const bands = diagnosticDentalSideBands(mesh, region, settings);
  if (bands.kind !== 'proposal') return bands;
  const outer = sampleDiagnosticContourContacts(mesh, region.outerEdges, bands.outerOtherSide,
    { spacing: settings.outerSpacing, maxSearchDistance: settings.maxSearchDistance,
      ...(settings.samplePhaseFraction === undefined ? {} : { phaseMm: settings.outerSpacing * settings.samplePhaseFraction }) });
  if (outer.kind !== 'proposal') return outer;
  const inner = sampleDiagnosticContourContacts(mesh, region.openingEdges, bands.innerOtherSide,
    { spacing: settings.innerSpacing, maxSearchDistance: settings.maxSearchDistance,
      ...(settings.samplePhaseFraction === undefined ? {} : { phaseMm: settings.innerSpacing * settings.samplePhaseFraction }) });
  if (inner.kind !== 'proposal') return inner;
  const contactFaces = new Uint8Array(mesh.indices.length / 3);
  for (let face = 0; face < contactFaces.length; face += 1) {
    contactFaces[face] = bands.outerOtherSide[face]! | bands.innerOtherSide[face]!;
  }
  return { kind: 'proposal', contactFaces, outerContacts: outer.contacts, innerContacts: inner.contacts };
}
