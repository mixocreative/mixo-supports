import { approxArray, exactArray, hashArray } from './golden';
import type { DentalRegionProposal } from '../../src/core/analysis/dentalRegion';
import type { PlacementResult } from '../../src/core/analysis/types';

/*
 * Snapshot shapes shared by the dental golden recorder (scripts/golden/record-dental.ts, ran the TS oracle once)
 * and the Rust parity tests. Rule 7: ids, faces, edges, masks exact (hashes); positions within 1e-5 mm.
 */

type Region = Extract<DentalRegionProposal, { kind: 'proposal' }>;

/** Hash of a list of strings (IDs): exact. */
export const idsHash = (ids: readonly string[]) => ({ count: ids.length, hash: hashArray(Array.from(ids.join('|'), (char) => char.charCodeAt(0)), 'u32') });

/** The tip ID the placement code derives from a unit-local position (`positionId`): 0.01 mm rounding. */
export const positionId = (position: ArrayLike<number>): string => `auto-${Array.from(position).map((value) => Math.round(value * 100)).join('_')}`;

export function regionSnapshot(region: Region) {
  const contacts = region.contacts!;
  return {
    allowedFaces: exactArray(region.allowedFaces, 'u8'),
    outerEdges: exactArray(region.outerEdges), outerRidgeEdges: exactArray(region.outerRidgeEdges),
    outerConnectorEdges: exactArray(region.outerConnectorEdges), openingEdges: exactArray(region.openingEdges),
    contactFaces: exactArray(region.contactFaces!, 'u8'),
    regionFaces: region.diagnostics.regionFaces, connectorLengths: region.diagnostics.connectorLengths,
    contactIds: idsHash(contacts.map((contact) => positionId(contact.position))),
    contactFacesOf: exactArray(contacts.map((contact) => contact.face)),
    contactRims: exactArray(contacts.map((contact) => (contact.rim === 'outer' ? 0 : 1))),
    positions: approxArray(contacts.flatMap((contact) => [...contact.position]), 7),
    normals: approxArray(contacts.flatMap((contact) => [...contact.normal]), 7),
    distances: approxArray(contacts.flatMap((contact) => [contact.distanceAlongContour, contact.distanceFromContour]), 5),
  };
}

export function placementSnapshot(result: PlacementResult) {
  return {
    ids: idsHash(result.points.map((point) => point.id)),
    first: result.points.slice(0, 5).map((point) => point.id),
    sources: idsHash(result.points.map((point) => point.source)),
    positions: approxArray(result.points.flatMap((point) => [...point.position]), 3),
    normals: approxArray(result.points.flatMap((point) => [...point.normal]), 3),
  };
}
