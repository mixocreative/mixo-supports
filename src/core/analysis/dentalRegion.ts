import type { TriangleMesh } from './types';
import { dentalEngine, type DentalRegionResultLike } from './dentalEngine';
import { defaultDentalTuning, parseDentalTuning, type DentalTuning } from './dentalTuning';
import { decodeContacts, type DiagnosticContourContact } from './dentalContourContacts';
import { DEFAULT_PROFILE_ID } from './dentalProfile';

export type DentalRegionProposal =
  | { kind: 'proposal'; allowedFaces: Uint8Array; outerEdges: Uint32Array; outerRidgeEdges: Uint32Array;
    outerConnectorEdges: Uint32Array; openingEdges: Uint32Array;
    /** Narrow ridge-side candidate; absent in old saved policies, which must fail closed. */
    contactFaces?: Uint8Array; contacts?: DiagnosticContourContact[];
    diagnostics: { regionFaces: [number, number]; connectorLengths: [number, number] } }
  | { kind: 'inconclusive'; reason: string };

const tuningArray = (tuning: DentalTuning) => {
  const { setbackMm, stripWidthMm, density } = parseDentalTuning(tuning);
  return Float64Array.of(setbackMm, stripWidthMm, density);
};

/** The strip and contacts of a result (the part `retune` replaces); rim labels as the host expects. */
function contactsOf(result: DentalRegionResultLike) {
  return { contactFaces: result.take_contact_faces(),
    contacts: decodeContacts(result.contact_faces_of(), result.contact_points(), result.contact_distances(), result.contact_rims()) };
}

/**
 * Two-contour face proposal and its narrow contact strip (Rust `propose_dental_region`). The
 * broad opening-facing region (`allowedFaces`) is not an exterior contact band; the permitted
 * strip is `contactFaces`. A failure is an `inconclusive` with its reason, never an empty area.
 */
export function proposeDentalSupportRegion(mesh: TriangleMesh, tuning: DentalTuning = defaultDentalTuning, profile: string = DEFAULT_PROFILE_ID): DentalRegionProposal {
  const result = dentalEngine().propose_dental_region(mesh.positions, mesh.indices, tuningArray(tuning), profile);
  try {
    if (!result.ok()) return { kind: 'inconclusive', reason: result.reason() };
    const faces = result.region_faces();
    const lengths = result.connector_lengths();
    return { kind: 'proposal', allowedFaces: result.take_allowed_faces(), outerEdges: result.take_outer_edges(),
      outerRidgeEdges: result.take_outer_ridge_edges(), outerConnectorEdges: result.take_outer_connector_edges(),
      openingEdges: result.take_opening_edges(), ...contactsOf(result),
      diagnostics: { regionFaces: [faces[0]!, faces[1]!], connectorLengths: [lengths[0]!, lengths[1]!] } };
  } finally {
    result.free();
  }
}

/** Recomputes only the narrow strip and exact contacts after operator tuning (Rust `retune_dental_region`). */
export function retuneDentalSupportRegion(mesh: TriangleMesh,
  region: Extract<DentalRegionProposal, { kind: 'proposal' }>, tuning: DentalTuning, profile: string = DEFAULT_PROFILE_ID): DentalRegionProposal {
  const result = dentalEngine().retune_dental_region(mesh.positions, mesh.indices, region.allowedFaces, region.outerEdges,
    region.openingEdges, tuningArray(tuning), Number.NaN, profile);
  try {
    if (!result.ok()) return { kind: 'inconclusive', reason: result.reason() };
    return { ...region, ...contactsOf(result) };
  } finally {
    result.free();
  }
}
