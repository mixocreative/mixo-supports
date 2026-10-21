/**
 * Heavy-mesh budgets (shared heavy-mesh spec, mixomesh `capabilities.js` / `ImportLimits.js`
 * pattern): a triangle budget per runtime, a warning above 1x, a refusal above 4x, and the tiers
 * the editor uses to decide what it can offer on a mesh.
 *
 * Budget numbers, measured (Task 9, synthetic 2M/5M/10M STL, Chrome, 64 GB / RTX 3090): import is
 * cheap (10M in 10 s, no main-thread block), but Generate peaks at about 0.85 GB of renderer memory
 * per million triangles (2M 1.75 GB, 5M 4.0 GB) and a 10M placement stopped the tab at about 6.5 GB.
 * So both runtimes refuse above 6M: a desktop shell runs the same Chromium renderer. (mixomesh, which
 * only imports and edits meshes, measured 2.5M / 10M web.) Raise these when placement memory drops.
 */

export type Runtime = 'web' | 'desktop';

/** Triangle budget per runtime: above it the editor warns and switches to the heavy tier. */
export const TRIANGLE_BUDGET: Readonly<Record<Runtime, number>> = { web: 1_500_000, desktop: 1_500_000 };

/** Above this many times the budget an import is refused. */
export const REFUSE_FACTOR = 4;

/** Estimated (not exact) counts are refused only this far over the limit (sampling margin). */
export const ESTIMATE_MARGIN = 1.25;

/** Up to this many triangles every tool works as usual. */
export const FULL_TIER_MAX = 300_000;

/**
 * full: everything. large (up to the budget): contact-tips preview by default, no zone overlay
 * refinement. heavy (over the budget): editing tools off; generation and export still use the
 * full mesh in workers; the viewport shows a simplified copy.
 */
export type Tier = 'full' | 'large' | 'heavy';

export function meshTier(triangles: number, runtime: Runtime): Tier {
  if (triangles < FULL_TIER_MAX) return 'full';
  return triangles <= TRIANGLE_BUDGET[runtime] ? 'large' : 'heavy';
}

export function refusalLimit(runtime: Runtime): number {
  return TRIANGLE_BUDGET[runtime] * REFUSE_FACTOR;
}

/**
 * An import over the triangle or memory limit. `code` is the shared error code ('too-large') and
 * `reason` which limit it hit, so the UI explains it in the user's language.
 */
export class CapacityError extends Error {
  readonly code = 'too-large';
  constructor(readonly fileName: string, readonly triangles: number, readonly limit: number, readonly runtime: Runtime, readonly reason: 'triangles' | 'memory' = 'triangles') {
    super(reason === 'triangles'
      ? `"${fileName}" has about ${triangles.toLocaleString('en-US')} triangles; this ${runtime} build handles up to ${limit.toLocaleString('en-US')}. Simplify or split the model.`
      : `"${fileName}" (about ${triangles.toLocaleString('en-US')} triangles) needs more memory than this device can give the editor. Simplify or split the model.`);
  }
}

/**
 * Refuses `triangles` over 4x the runtime budget: an exact count at once, an estimate only past
 * the sampling margin (the post-parse check catches the rest).
 */
export function assertTriangleCapacity(fileName: string, triangles: number, runtime: Runtime, exact: boolean): void {
  const limit = refusalLimit(runtime);
  if (triangles > (exact ? limit : limit * ESTIMATE_MARGIN)) throw new CapacityError(baseName(fileName), Math.round(triangles), limit, runtime);
}

/**
 * Bytes one imported mesh costs at its peak: the welded mesh (about 18 B per triangle: half as many
 * vertices at 12 B, indices at 12 B) times the copies that can exist at once (scene, import worker
 * while welding, preview worker cache, an analysis job's copy and its turned copy, an export), plus
 * the pick index (about 16 B per triangle) and the import worker's weld table and read chunk.
 */
export const MESH_BYTES_PER_TRIANGLE = 18;
export const PEAK_COPIES = 5;
export const BVH_BYTES_PER_TRIANGLE = 16;
const IMPORT_OVERHEAD_BYTES = 64 * 1024 * 1024;

export function estimateImportBytes(triangles: number): number {
  return triangles * (MESH_BYTES_PER_TRIANGLE * PEAK_COPIES + BVH_BYTES_PER_TRIANGLE) + IMPORT_OVERHEAD_BYTES;
}

/**
 * Memory the editor may plan for: the JS heap limit and half the device memory where the browser
 * reports them (Chrome), else a conservative 1 GiB.
 */
export function memoryCapBytes({ jsHeapSizeLimit, deviceMemoryGb }: { jsHeapSizeLimit?: number; deviceMemoryGb?: number }): number {
  const known = [jsHeapSizeLimit, deviceMemoryGb === undefined ? undefined : deviceMemoryGb * 1024 ** 3 / 2].filter((value): value is number => typeof value === 'number' && value > 0);
  return known.length > 0 ? Math.min(...known) : 1024 ** 3;
}

/** Refuses an import whose estimated peak is over the memory cap. */
export function assertMemoryCapacity(fileName: string, triangles: number, runtime: Runtime, capBytes: number): void {
  if (estimateImportBytes(triangles) > capBytes) throw new CapacityError(baseName(fileName), Math.round(triangles), refusalLimit(runtime), runtime, 'memory');
}

function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '');
}
