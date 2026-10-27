// TEST-ONLY ORACLE (SHIP-PLAN U7): the frozen TS reference of the generic body-clearance review, ported to Rust `supports/safety/clearance.rs`.
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import type { GeneratedSupportMesh, SupportPart } from '../../../../src/core/supports/mesh';
import { supportBodyConflicts } from './bodyIntersection';
import { isIntentionalContactReach } from './contactReach';
import { createModelCollisionIndex, type ModelCollisionIndex } from './modelCollisionIndex';
import { contactRadius, tipDepth, type LiveSupportSettings } from '../../../../src/core/supports/settings';

export interface GenericBodyIssue {
  part: SupportPart;
  contactId?: string;
  origin: 'auto' | 'manual' | 'structural' | 'unknown';
  modelFaceIndex: number;
  classification: 'blocked' | 'inconclusive';
}

export interface GenericBodyClearanceReport {
  status: 'clear' | 'blocked' | 'inconclusive';
  issues: GenericBodyIssue[];
  reason?: string;
}

/** Exact full-mesh body-clearance report; clear means no body intersection, not print-stable. */
export function reviewGenericBodyClearance(model: TriangleMesh, supports: GeneratedSupportMesh,
  settings: Readonly<LiveSupportSettings>, origins: ReadonlyMap<string, 'auto' | 'manual'>,
  suppliedIndex?: ModelCollisionIndex): GenericBodyClearanceReport {
  const index = suppliedIndex ?? createModelCollisionIndex(model);
  if (index.model !== model) throw new Error('collision index belongs to another model');
  let covered = 0;
  const validSupports = supports.positions.length % 3 === 0 && supports.indices.length % 3 === 0 &&
    supports.positions.every(Number.isFinite) &&
    supports.indices.every((vertex) => vertex < supports.positions.length / 3) &&
    supports.components.every((component) => {
      const valid = component.start === covered && component.count >= 0 && component.count % 3 === 0;
      covered += component.count;
      return valid;
    }) && covered === supports.indices.length;
  if (!index.valid || !validSupports) return { status: 'inconclusive', issues: [], reason: 'invalid-geometry' };
  const limits = {
    radiusMm: settings.neckLength + settings.pillarDiameter / 2 + contactRadius(settings),
    penetrationMm: Math.max(0, tipDepth(settings)) + contactRadius(settings) + 0.05,
    faceNormalDotMin: 0.8,
  };
  const hits = supportBodyConflicts(model, supports, () => true, false,
    (hit) => isIntentionalContactReach(model, supports, hit, limits), index);
  const issues: GenericBodyIssue[] = hits.map((hit) => {
    const { component } = hit;
    const uncertainContact = (component.part === 'tip' || component.part === 'neck' ||
      component.part === 'tree-branch' || (component.part === 'pillar' && !!component.landingReach)) &&
      !component.contactIntent?.some((intent) => intent.faceIndex !== undefined);
    return {
      part: component.part,
      ...(component.contactId ? { contactId: component.contactId } : {}),
      origin: component.contactId ? origins.get(component.contactId) ?? 'unknown' : 'structural',
      modelFaceIndex: hit.modelFaceIndex,
      classification: uncertainContact ? 'inconclusive' : 'blocked',
    };
  });
  return { status: issues.some((issue) => issue.classification === 'blocked') ? 'blocked' :
    issues.length > 0 ? 'inconclusive' : 'clear', issues };
}
