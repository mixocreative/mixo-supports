import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh, SupportComponent } from './mesh';
import { intersectingSupportComponents, supportBodyConflicts } from './bodyIntersection';
import { isIntentionalContactReach } from './contactReach';
import type { ModelCollisionIndex } from './modelCollisionIndex';
import { contactRadius, defaultSupportSettings, tipDepth, type LiveSupportSettings } from './settings';

/** Dental policy: reject automatic pillar bodies, exempting only their marked landing-tip reach. */
export function crossingAutomaticBodyContactIds(model: TriangleMesh, supports: GeneratedSupportMesh,
  automaticIds: ReadonlySet<string>, collisionIndex?: ModelCollisionIndex): string[] {
  if (automaticIds.size === 0) return [];
  return [...new Set(intersectingSupportComponents(model, supports,
    (component) => component.part === 'pillar' && !!component.contactId && automaticIds.has(component.contactId), true, collisionIndex)
    .map((component) => component.contactId!))].sort();
}

/** Dental policy: report crossing tree and brace components for conservative mode fallback. */
export function crossingSupportStructureParts(model: TriangleMesh, supports: GeneratedSupportMesh,
  settings: Readonly<LiveSupportSettings> = defaultSupportSettings,
  collisionIndex?: ModelCollisionIndex): Array<'tree-branch' | 'tree-trunk' | 'brace'> {
  const treeNeck = (component: SupportComponent) => component.part === 'neck' && component.structureKind === 'tree';
  const part = (component: SupportComponent) => component.part === 'tree-branch' || component.part === 'tree-trunk' ||
    component.part === 'brace' || treeNeck(component);
  if (!supports.components.some(part)) return [];
  const limits = {
    radiusMm: settings.neckLength + settings.pillarDiameter / 2 + contactRadius(settings),
    penetrationMm: Math.max(0, tipDepth(settings)) + contactRadius(settings) + 0.05,
    faceNormalDotMin: 0.8,
  };
  return [...new Set(supportBodyConflicts(model, supports, part, false,
    (hit) => (hit.component.part === 'tree-branch' || treeNeck(hit.component)) &&
      isIntentionalContactReach(model, supports, hit, limits), collisionIndex)
    .map((hit) => treeNeck(hit.component) ? 'tree-branch' as const : hit.component.part as 'tree-branch' | 'tree-trunk' | 'brace'))].sort();
}
