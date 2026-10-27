import type { TriangleMesh } from './types';
import type { DentalRegionProposal } from './dentalRegion';
import { dentalEngine } from './dentalEngine';
import { decodeContacts, type DiagnosticContourContact } from './dentalContourContacts';
import { REFERENCE_ALIGNER_PROFILE } from './dentalProfile';

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

const { defaults } = REFERENCE_ALIGNER_PROFILE;

/** Current one-reference defaults, read from the aligner profile data. */
export const defaultDentalContactFootprintSettings: Readonly<DentalContactFootprintSettings> = {
  setback: defaults.setbackMm, width: defaults.setbackMm + 1, outerSpacing: defaults.outerSpacingMm,
  innerSpacing: defaults.innerSpacingMm, maxSearchDistance: defaults.maxSearchMm,
};

export type DentalContactFootprint =
  | { kind: 'proposal'; contactFaces: Uint8Array; outerContacts: DiagnosticContourContact[];
    innerContacts: DiagnosticContourContact[] }
  | { kind: 'inconclusive'; reason: string };

/**
 * The narrow contact candidate for a region's contours (Rust `dental_footprint`). The old broad
 * face cut only distinguishes the two sides of each ridge. This proposal is not a production
 * permission: contact approach, secondary landings, and body paths still need to be checked
 * before a support is built.
 */
export function proposeDentalContactFootprint(mesh: TriangleMesh, region: Region,
  settings: DentalContactFootprintSettings): DentalContactFootprint {
  const result = dentalEngine().dental_footprint(mesh.positions, mesh.indices, region.allowedFaces, region.outerEdges, region.openingEdges,
    Float64Array.of(settings.setback, settings.width, settings.outerSpacing, settings.innerSpacing, settings.maxSearchDistance,
      settings.samplePhaseFraction ?? Number.NaN));
  try {
    if (!result.ok()) return { kind: 'inconclusive', reason: result.reason() };
    const contacts = decodeContacts(result.contact_faces_of(), result.contact_points(), result.contact_distances(), result.contact_rims());
    const strip = (rim: 'outer' | 'opening') => contacts.filter((contact) => contact.rim === rim).map(({ rim: _rim, ...contact }) => contact);
    return { kind: 'proposal', contactFaces: result.take_contact_faces(), outerContacts: strip('outer'), innerContacts: strip('opening') };
  } finally {
    result.free();
  }
}
