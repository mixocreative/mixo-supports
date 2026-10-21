import type { WorkerLike } from './WorkerTask';

/*
 * The app's worker factories, the only place a Worker is created (Vite bundles a worker from the
 * literal `new Worker(new URL(...), { type: 'module' })` at its call site). Clients get these
 * injected, so tests hand them stand-ins and another host can bring its own. Null without
 * Worker support; the clients then reject (no main-thread fallback for heavy jobs).
 */

const hasWorker = typeof Worker !== 'undefined';

export const createImportWorker = hasWorker ? () => new Worker(new URL('./importWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike : null;
export const createAnalysisWorker = hasWorker ? () => new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike : null;
export const createMeshWorker = hasWorker ? () => new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike : null;
