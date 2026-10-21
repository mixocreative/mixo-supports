import type { Runtime } from '../core/budget';

/**
 * The runtime tier the budgets apply to: 'desktop' in an Electron-like shell (or a build made with
 * VITE_RUNTIME=desktop), else 'web'.
 */
export function detectRuntime(): Runtime {
  if ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_RUNTIME === 'desktop') return 'desktop';
  return typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent) ? 'desktop' : 'web';
}

/** What the browser says about memory (Chrome reports both; others neither). */
export function memoryInfo(): { jsHeapSizeLimit?: number; deviceMemoryGb?: number } {
  const performanceMemory = (globalThis.performance as { memory?: { jsHeapSizeLimit?: number } } | undefined)?.memory;
  const deviceMemory = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory;
  return {
    ...(performanceMemory?.jsHeapSizeLimit ? { jsHeapSizeLimit: performanceMemory.jsHeapSizeLimit } : {}),
    ...(deviceMemory ? { deviceMemoryGb: deviceMemory } : {}),
  };
}
