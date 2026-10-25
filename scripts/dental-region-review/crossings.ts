import type { TriangleMesh } from '../../src/core/analysis/types';
import type { GeneratedSupportMesh, SupportPart } from '../../src/core/supports/mesh';
import { tipsOf } from '../../src/core/supports/meshQuery';
import type { Vector } from '../../src/core/vec3';
import { BufferGeometry, Float32BufferAttribute, Line3, Matrix4, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface SupportCrossingReport {
  total: number;
  /** Pillar triangle pairs not part of the builder's explicit secondary landing-tip reach. */
  bodyPillarCrossings: number;
  bodyPillarOutsideContactBand: number;
  bodyPillarContactIds: string[];
  byPart: Partial<Record<SupportPart, number>>;
  outsideContactBand: Partial<Record<SupportPart, number>>;
  contactIdsByPart: Partial<Record<SupportPart, string[]>>;
  examples: { modelFace: number; supportFace: number; part: SupportPart; contactId?: string }[];
  /** Distance of actual non-coplanar neck/mesh intersection segments from their owning primary contact; secondary landings are not classified. */
  neckReach?: { measuredPairs: number; coplanarPairs: number; maxDistanceMm: number };
}

function geometry(mesh: TriangleMesh): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
  result.setIndex(Array.from(mesh.indices));
  return result;
}

/** Exact triangle intersections; this is a diagnostic, not a production collision gate. Both meshes must share plate space. */
export function diagnoseSupportCrossings(model: TriangleMesh, supports: GeneratedSupportMesh, contactFaces?: Uint8Array,
  contactPositions?: ReadonlyMap<string, Vector>): SupportCrossingReport {
  const report: SupportCrossingReport = { total: 0, bodyPillarCrossings: 0, bodyPillarOutsideContactBand: 0,
    bodyPillarContactIds: [], byPart: {}, outsideContactBand: {}, contactIdsByPart: {}, examples: [] };
  if (contactPositions) report.neckReach = { measuredPairs: 0, coplanarPairs: 0, maxDistanceMm: 0 };
  if (model.indices.length === 0 || supports.indices.length === 0) return report;
  if (contactFaces && contactFaces.length !== model.indices.length / 3) throw new Error('Contact mask does not match model faces');
  const contacts = new Map<SupportPart, Set<string>>();
  const bodyPillarContacts = new Set<string>();
  const tipView = tipsOf(supports);
  const tipTriangles = new Set<string>();
  const triangleKey = (indices: Uint32Array, at: number) => `${indices[at]},${indices[at + 1]},${indices[at + 2]}`;
  for (let at = 0; at < tipView.indices.length; at += 3) tipTriangles.add(triangleKey(tipView.indices, at));
  const modelGeometry = geometry(model);
  const supportGeometry = geometry(supports);
  const modelBvh = new MeshBVH(modelGeometry, { indirect: true });
  const supportBvh = new MeshBVH(supportGeometry, { indirect: true });
  const modelNormal = new Vector3(), supportNormal = new Vector3(), segment = new Line3();
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
      if (owner.part === 'pillar' && !tipTriangles.has(triangleKey(supports.indices, at))) {
        report.bodyPillarCrossings++;
        if (contactFaces && !contactFaces[modelFace]) report.bodyPillarOutsideContactBand++;
        if (owner.contactId) bodyPillarContacts.add(owner.contactId);
      }
      if (owner.contactId) {
        if (!contacts.has(owner.part)) contacts.set(owner.part, new Set());
        contacts.get(owner.part)!.add(owner.contactId);
      }
      const contact = owner.part === 'neck' && owner.contactId ? contactPositions?.get(owner.contactId) : undefined;
      if (contact && report.neckReach) {
        modelTriangle.getNormal(modelNormal);
        supportTriangle.getNormal(supportNormal);
        if (Math.abs(modelNormal.dot(supportNormal)) > 1 - 1e-10) report.neckReach.coplanarPairs++;
        else if (modelTriangle.intersectsTriangle(supportTriangle, segment)) {
          const point = new Vector3(...contact);
          report.neckReach.measuredPairs++;
          report.neckReach.maxDistanceMm = Math.max(report.neckReach.maxDistanceMm,
            segment.start.distanceTo(point), segment.end.distanceTo(point));
        }
      }
      if (report.examples.length < 30) report.examples.push({ modelFace, supportFace, part: owner.part, contactId: owner.contactId });
      return false;
    },
  });
  for (const [part, ids] of contacts) report.contactIdsByPart[part] = [...ids].sort();
  report.bodyPillarContactIds = [...bodyPillarContacts].sort();
  modelGeometry.dispose();
  supportGeometry.dispose();
  return report;
}
