import { binaryStlTriangles, stlKind } from './stl';

/**
 * Triangle count of a model file before it is parsed, from its size and its first bytes (shared
 * heavy-mesh spec, "pre-parse estimate"): exact for binary STL and glTF/GLB, sampled for ASCII STL.
 * Null when the head does not say (the post-parse check decides then).
 */

/** How much of the file the estimate reads (a .gltf is read whole when it is no larger). */
export const ESTIMATE_HEAD_BYTES = 1 << 20;

export interface TriangleEstimate {
  triangles: number;
  exact: boolean;
}

export function estimateTriangles(head: Uint8Array, size: number, fileName: string): TriangleEstimate | null {
  const extension = fileName.toLowerCase().replace(/^.*\./, '');
  try {
    if (extension === 'stl') return estimateStl(head, size);
    if (extension === 'glb') return estimateGlb(head);
    if (extension === 'gltf') return head.length >= size ? countGltf(JSON.parse(new TextDecoder().decode(head)) as Gltf) : null;
  } catch {
    // A damaged header: no estimate; parsing reports the problem in its own words.
  }
  return null;
}

function estimateStl(head: Uint8Array, size: number): TriangleEstimate | null {
  if (stlKind(head, size) === 'binary') return { triangles: binaryStlTriangles(head, size), exact: true };
  const text = new TextDecoder('latin1').decode(head);
  const facets = text.split('endfacet').length - 1;
  if (facets === 0) return null;
  if (head.length >= size) return { triangles: facets, exact: true };
  // Bytes per facet over the complete facets in the head.
  const sampled = text.lastIndexOf('endfacet') + 'endfacet'.length;
  return { triangles: Math.round(size / (sampled / facets)), exact: false };
}

function estimateGlb(head: Uint8Array): TriangleEstimate | null {
  if (head.length < 20) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return null;
  const length = view.getUint32(12, true);
  if (20 + length > head.length) return null;
  return countGltf(JSON.parse(new TextDecoder().decode(head.subarray(20, 20 + length))) as Gltf);
}

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[] }[];
  meshes?: { primitives: { attributes: { POSITION?: number }; indices?: number; mode?: number }[] }[];
  accessors?: { count: number }[];
}

/** Triangles of every mesh instance the scene graph reaches (each becomes a unit). */
function countGltf(gltf: Gltf): TriangleEstimate {
  const accessors = gltf.accessors ?? [];
  const meshTriangles = (gltf.meshes ?? []).map((mesh) => mesh.primitives.reduce((sum, primitive) => {
    const mode = primitive.mode ?? 4;
    const count = primitive.indices !== undefined ? accessors[primitive.indices]?.count ?? 0 : accessors[primitive.attributes.POSITION ?? -1]?.count ?? 0;
    if (mode === 4) return sum + Math.floor(count / 3);
    if (mode === 5 || mode === 6) return sum + Math.max(0, count - 2);
    return sum;
  }, 0));
  const nodes = gltf.nodes ?? [];
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes;
  if (!roots) return { triangles: meshTriangles.reduce((a, b) => a + b, 0), exact: true };
  let triangles = 0;
  const visit = (index: number, depth: number) => {
    const node = nodes[index];
    if (!node || depth > 64) return;
    if (node.mesh !== undefined) triangles += meshTriangles[node.mesh] ?? 0;
    node.children?.forEach((child) => visit(child, depth + 1));
  };
  roots.forEach((root) => visit(root, 0));
  return { triangles, exact: true };
}
