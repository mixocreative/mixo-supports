import type { TriangleMesh } from './types';
import { dot } from '../vec3';
import { proposeDentalContours, type Edge, type MeshContext } from './dentalContours';

export type DentalRegionProposal =
  | { kind: 'proposal'; allowedFaces: Uint8Array; outerEdges: Uint32Array; outerRidgeEdges: Uint32Array;
    outerConnectorEdges: Uint32Array; openingEdges: Uint32Array;
    diagnostics: { regionFaces: [number, number]; connectorLengths: [number, number] } }
  | { kind: 'inconclusive'; reason: string };

/** Diagnostic face cut. Its broad opening-facing region is not an exterior contact band. */
function classifyFaces(context: MeshContext, outer: Set<Edge>, opening: Set<Edge>):
  { allowedFaces: Uint8Array; regionFaces: [number, number] } | null {
  const blocked = new Set<Edge>([...outer, ...opening]);
  if (blocked.size !== outer.size + opening.size) return null;
  const faceCount = context.mesh.indices.length / 3;
  const parent = Int32Array.from({ length: faceCount }, (_, index) => index);
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root]!;
    while (start !== root) { const next = parent[start]!; parent[start] = root; start = next; }
    return root;
  };
  for (const edge of context.edges.values()) if (!blocked.has(edge)) parent[find(edge.faces[0]!)] = find(edge.faces[1]!);
  const regions = new Map<number, { faces: number; sumOpening: number }>();
  for (let face = 0; face < faceCount; face += 1) {
    const root = find(face);
    const region = regions.get(root) ?? { faces: 0, sumOpening: 0 };
    region.faces += 1;
    region.sumOpening += dot(context.normals[face]!, context.rim.openingDirection);
    regions.set(root, region);
  }
  if (regions.size !== 2) return null;
  const ranked = [...regions.entries()].sort((a, b) => b[1].sumOpening / b[1].faces - a[1].sumOpening / a[1].faces);
  const [allowed, forbidden] = ranked;
  if (!allowed || !forbidden || allowed[1].sumOpening / allowed[1].faces < 0.2 || forbidden[1].sumOpening / forbidden[1].faces > -0.15) return null;
  if (allowed[1].faces / faceCount < 0.2 || allowed[1].faces / faceCount > 0.85) return null;
  const allowedFaces = new Uint8Array(faceCount);
  for (let face = 0; face < faceCount; face += 1) if (find(face) === allowed[0]) allowedFaces[face] = 1;
  return { allowedFaces, regionFaces: [allowed[1].faces, forbidden[1].faces] };
}

/** Historical two-contour face proposal, retained for diagnostics and current policy compatibility. */
export function proposeDentalSupportRegion(mesh: TriangleMesh): DentalRegionProposal {
  const contours = proposeDentalContours(mesh);
  if (contours.kind !== 'proposal') return contours;
  const classified = classifyFaces(contours.context, contours.outer, contours.opening);
  if (!classified) return { kind: 'inconclusive', reason: 'surface-region-not-isolated' };
  return { kind: 'proposal', ...classified, outerEdges: contours.outerEdges,
    outerRidgeEdges: contours.outerRidgeEdges, outerConnectorEdges: contours.outerConnectorEdges,
    openingEdges: contours.openingEdges,
    diagnostics: { regionFaces: classified.regionFaces, connectorLengths: contours.connectorLengths } };
}
