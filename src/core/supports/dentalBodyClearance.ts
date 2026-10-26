import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh, SupportComponent } from './mesh';
import { intersectingSupportComponents } from './bodyIntersection';

/** Dental policy: reject automatic pillar bodies, exempting only their marked landing-tip reach. */
export function crossingAutomaticBodyContactIds(model: TriangleMesh, supports: GeneratedSupportMesh, automaticIds: ReadonlySet<string>): string[] {
  if (automaticIds.size === 0) return [];
  return [...new Set(intersectingSupportComponents(model, supports,
    (component) => component.part === 'pillar' && !!component.contactId && automaticIds.has(component.contactId), true)
    .map((component) => component.contactId!))].sort();
}

/** Dental policy: report crossing tree and brace components for conservative mode fallback. */
export function crossingSupportStructureParts(model: TriangleMesh, supports: GeneratedSupportMesh): Array<'tree-branch' | 'tree-trunk' | 'brace'> {
  const part = (component: SupportComponent) => component.part === 'tree-branch' || component.part === 'tree-trunk' || component.part === 'brace';
  if (!supports.components.some(part)) return [];
  return [...new Set(intersectingSupportComponents(model, supports, part)
    .map((component) => component.part as 'tree-branch' | 'tree-trunk' | 'brace'))].sort();
}
