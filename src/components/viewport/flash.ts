/** How long the ring at a freshly added support stays. */
export const FLASH_MS = 400;

/** The ring's size (a multiple of its start) and opacity `elapsed` ms in: it widens and fades; undefined once it is over. */
export function flashLook(elapsed: number): { scale: number; opacity: number } | undefined {
  if (elapsed < 0 || elapsed >= FLASH_MS) return undefined;
  const progress = elapsed / FLASH_MS;
  return { scale: 1 + 1.5 * progress, opacity: 0.9 * (1 - progress) };
}
