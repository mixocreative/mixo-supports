import type { TriangleMesh } from '../../src/core/analysis/types';
import type { GeneratedSupportMesh, SupportPart } from '../../src/core/supports/mesh';
import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface SupportCrossingReport {
  total: number;
  byPart: Partial<Record<SupportPart, number>>;
  outsideContactBand: Partial<Record<SupportPart, number>>;
  contactIdsByPart: Partial<Record<SupportPart, string[]>>;
  examples: { modelFace: number; supportFace: number; part: SupportPart; contactId?: string }[];
}

function geometry(mesh: TriangleMesh): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
  result.setIndex(Array.from(mesh.indices));
  return result;
}

/** Exact triangle intersections; this is a diagnostic, not a production collision gate. Both meshes must share plate space. */
export function diagnoseSupportCrossings(model: TriangleMesh, supports: GeneratedSupportMesh, contactFaces?: Uint8Array): SupportCrossingReport {
  const report: SupportCrossingReport = { total: 0, byPart: {}, outsideContactBand: {}, contactIdsByPart: {}, examples: [] };
  if (model.indices.length === 0 || supports.indices.length === 0) return report;
  if (contactFaces && contactFaces.length !== model.indices.length / 3) throw new Error('Contact mask does not match model faces');
  const contacts = new Map<SupportPart, Set<string>>();
  const modelGeometry = geometry(model);
  const supportGeometry = geometry(supports);
  const modelBvh = new MeshBVH(modelGeometry, { indirect: true });
  const supportBvh = new MeshBVH(supportGeometry, { indirect: true });
  modelBvh.bvhcast(supportBvh, new Matrix4(), {
    intersectsTriangles: (modelTriangle, supportTriangle, modelIndex, supportIndex) => {
      if (!modelTriangle.intersectsTriangle(supportTriangle)) return false;
      const modelFace = modelBvh.resolveTriangleIndex(modelIndex);
      const supportFace = supportBvh.resolveTriangleIndex(supportIndex);
      const at = supportFace * 3;
      const owner = supports.components.find((component) => at >= component.start && at < component.start + component.count);
      if (!owner) throw new Error(`Support triangle ${supportFace} has no component`);
      report.total++;
      report.byPart[owner.part] = (report.byPart[owner.part] ?? 0) + 1;
      if (contactFaces && !contactFaces[modelFace]) report.outsideContactBand[owner.part] = (report.outsideContactBand[owner.part] ?? 0) + 1;
      if (owner.contactId) {
        if (!contacts.has(owner.part)) contacts.set(owner.part, new Set());
        contacts.get(owner.part)!.add(owner.contactId);
      }
      if (report.examples.length < 30) report.examples.push({ modelFace, supportFace, part: owner.part, contactId: owner.contactId });
      return false;
    },
  });
  for (const [part, ids] of contacts) report.contactIdsByPart[part] = [...ids].sort();
  modelGeometry.dispose();
  supportGeometry.dispose();
  return report;
}
