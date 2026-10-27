import type { ModelCollisionIndex } from './modelCollisionIndex';
import type { SupportRoute } from './supportRoute';
import { preflightSupportPath } from './pathPreflight';

export type ColumnPathScreen =
  | { status: 'blocked'; part: SupportRoute['part']; modelFaceIndex: number }
  | { status: 'defer'; reason: string };

/** Finds only definite shaft/foot centre-line crossings; every other case needs exact built-mesh review. */
export function screenColumnRoutes(index: ModelCollisionIndex, routes: readonly SupportRoute[],
  cancelled?: () => boolean): ColumnPathScreen {
  if (cancelled?.()) return { status: 'defer', reason: 'cancelled' };
  let uncertainReason = 'exact-contact-check';
  let checked = false;
  for (const route of routes) {
    // Contact necks are intentionally embedded in the source surface and need face-local built-geometry classification.
    if (route.part !== 'pillar' && route.part !== 'foot') continue;
    checked = true;
    const result = preflightSupportPath(index, route.points, route.radiusMm,
      { uncertainEndMm: route.uncertainEndMm, cancelled });
    if (result.status === 'blocked') return { status: 'blocked', part: route.part, modelFaceIndex: result.modelFaceIndex };
    if (result.status === 'inconclusive') {
      if (result.reason === 'cancelled' || result.reason === 'invalid-geometry' || result.reason === 'query-budget') {
        return { status: 'defer', reason: result.reason };
      }
      uncertainReason = result.reason;
    }
  }
  return { status: 'defer', reason: checked ? uncertainReason : 'no-shaft-route' };
}
