import { describe, expect, it } from 'vitest';
import { FLASH_MS, flashLook } from './flash';

describe('flashLook', () => {
  it('widens and fades over 400 ms, then is gone', () => {
    expect(FLASH_MS).toBe(400);
    expect(flashLook(0)).toEqual({ scale: 1, opacity: 0.9 });
    const mid = flashLook(200)!;
    expect(mid.scale).toBeGreaterThan(1);
    expect(mid.opacity).toBeLessThan(0.9);
    expect(flashLook(FLASH_MS)).toBeUndefined();
  });
});
