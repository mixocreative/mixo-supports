import type { DentalDiagnosticBands } from '../core/analysis/dentalContactBand';
import type { DiagnosticContourContact } from '../core/analysis/dentalContourContacts';
import type { DentalRegionProposal } from '../core/analysis/dentalRegion';
import type { TriangleMesh } from '../core/analysis/types';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { withSession } from '../supports/supportEngine';

/*
 * Host adapter of the Rust `diagnose` (docs/SHIP-PLAN.md ABI): the review GLB's geometry as coloured
 * layers, one per role, with colours from the contour spec. The Node review script and any other
 * host only write what comes back. Review only; no layer is support permission.
 */

export interface ReviewLayer {
  name: string;
  /** 0xRRGGBB */
  color: number;
  positions: Float32Array;
  /** Empty: `positions` is a triangle soup. */
  indices: Uint32Array;
}

export interface DiagnoseInput {
  region: Extract<DentalRegionProposal, { kind: 'proposal' }>;
  bands?: DentalDiagnosticBands;
  /** Sampled contacts that are not generated supports. */
  contacts?: { outer: readonly DiagnosticContourContact[]; inner: readonly DiagnosticContourContact[] };
  /** The built supports, in the same frame as the model. */
  supports?: GeneratedSupportMesh;
}

interface Diagnosis {
  revision(): number;
  layer_count(): number;
  layer_name(layer: number): string;
  layer_color(layer: number): number;
  take_layer_positions(layer: number): Float32Array;
  take_layer_indices(layer: number): Uint32Array;
  free(): void;
}

interface DiagnoseSession {
  load_mesh(positions: Float32Array, indices: Uint32Array): number;
  diagnose(model: number, revision: number, profile: string, contactFaces: Uint8Array, ridge: Uint32Array, connectors: Uint32Array, opening: Uint32Array,
    bands: Uint8Array, outer: Float64Array, inner: Float64Array, supportPositions: Float32Array, supportIndices: Uint32Array, tips: Uint8Array): Diagnosis;
}

const contactRows = (contacts: readonly DiagnosticContourContact[] = []) => Float64Array.from(contacts.flatMap((c) => [...c.position, ...c.normal]));

export function diagnose(mesh: TriangleMesh, input: DiagnoseInput, profile: string, revision = 0): ReviewLayer[] {
  const { region, bands, supports } = input;
  const faces = mesh.indices.length / 3;
  const tips = new Uint8Array((supports?.indices.length ?? 0) / 3);
  for (const component of supports?.components ?? []) if (component.part === 'tip') tips.fill(1, component.start / 3, (component.start + component.count) / 3);
  const packedBands = new Uint8Array(bands ? faces * 4 : 0);
  if (bands) [bands.outerOpeningSide, bands.outerOtherSide, bands.innerOpeningSide, bands.innerOtherSide].forEach((mask, k) => packedBands.set(mask, k * faces));
  return withSession((raw) => {
    const session = raw as unknown as DiagnoseSession;
    const result = session.diagnose(
      session.load_mesh(Float32Array.from(mesh.positions), Uint32Array.from(mesh.indices)), revision, profile,
      region.contactFaces ?? new Uint8Array(), region.outerRidgeEdges, region.outerConnectorEdges, region.openingEdges,
      packedBands, contactRows(input.contacts?.outer), contactRows(input.contacts?.inner),
      supports?.positions ?? new Float32Array(), supports?.indices ?? new Uint32Array(), tips,
    );
    try {
      if (result.revision() !== revision) throw new Error('diagnose answered another revision');
      return Array.from({ length: result.layer_count() }, (_, k): ReviewLayer => ({
        name: result.layer_name(k), color: result.layer_color(k), positions: result.take_layer_positions(k), indices: result.take_layer_indices(k),
      }));
    } finally {
      result.free();
    }
  });
}
