import type { Vector } from '../vec3';

/** Proposed tube centre-line in the builder's plate-space millimetre frame. */
export interface SupportRoute {
  part: 'neck' | 'pillar' | 'foot' | 'tree-branch' | 'tree-trunk' | 'brace';
  contactId?: string;
  origin?: 'auto' | 'manual';
  points: readonly Vector[];
  /** Conservative maximum radius along the route; final mesh still needs exact testing. */
  radiusMm: number;
  /** Printed secondary-contact reach to defer to exact classification, measured back from this route's end. */
  uncertainEndMm?: number;
}

export function routeFromNodes(part: SupportRoute['part'], nodes: readonly { point: Vector; radius: number }[],
  contactId?: string, origin?: SupportRoute['origin'], uncertainEndMm?: number): SupportRoute {
  let radiusMm = 0;
  for (const node of nodes) radiusMm = Math.max(radiusMm, node.radius);
  return { part, ...(contactId ? { contactId } : {}), ...(origin ? { origin } : {}),
    ...(uncertainEndMm === undefined ? {} : { uncertainEndMm }),
    points: nodes.map((node) => [...node.point] as Vector), radiusMm };
}
