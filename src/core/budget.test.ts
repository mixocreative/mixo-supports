import { describe, expect, it } from 'vitest';
import { assertTriangleCapacity, CapacityError, estimateImportBytes, FULL_TIER_MAX, memoryCapBytes, meshTier, refusalLimit, TRIANGLE_BUDGET } from './budget';

describe('budgets and tiers', () => {
  it('warns at 1x and refuses above 4x the runtime budget', () => {
    expect(refusalLimit('web')).toBe(TRIANGLE_BUDGET.web * 4);
    expect(refusalLimit('desktop')).toBe(TRIANGLE_BUDGET.desktop * 4);
  });

  it('sorts meshes into full, large and heavy tiers', () => {
    expect(meshTier(FULL_TIER_MAX - 1, 'web')).toBe('full');
    expect(meshTier(FULL_TIER_MAX, 'web')).toBe('large');
    expect(meshTier(TRIANGLE_BUDGET.web, 'web')).toBe('large');
    expect(meshTier(TRIANGLE_BUDGET.web + 1, 'web')).toBe('heavy');
    expect(meshTier(TRIANGLE_BUDGET.desktop + 1, 'desktop')).toBe('heavy');
  });

  it('refuses an exact count over the limit, and an estimate only with a 25 % margin', () => {
    const limit = refusalLimit('web');
    expect(() => assertTriangleCapacity('big.stl', limit, 'web', true)).not.toThrow();
    expect(() => assertTriangleCapacity('big.stl', limit + 1, 'web', true)).toThrow(CapacityError);
    expect(() => assertTriangleCapacity('big.stl', limit * 1.2, 'web', false)).not.toThrow();
    expect(() => assertTriangleCapacity('big.stl', limit * 1.3, 'web', false)).toThrow(CapacityError);
  });

  it('words the refusal like mixomesh: file, about N, the limit, what to do', () => {
    try {
      assertTriangleCapacity('C:/scans/statue.stl', 10_000_000, 'web', true);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CapacityError);
      const capacity = error as CapacityError;
      expect(capacity.code).toBe('too-large');
      expect(capacity.reason).toBe('triangles');
      expect(capacity.triangles).toBe(10_000_000);
      expect(capacity.limit).toBe(refusalLimit('web'));
      expect(capacity.message).toBe(`"statue.stl" has about 10,000,000 triangles; this web build handles up to ${refusalLimit('web').toLocaleString('en-US')}. Simplify or split the model.`);
    }
  });

  it('estimates import memory from the triangle count and caps it by the device', () => {
    expect(estimateImportBytes(1_000_000)).toBeGreaterThan(estimateImportBytes(500_000));
    expect(memoryCapBytes({})).toBe(1024 ** 3);
    expect(memoryCapBytes({ jsHeapSizeLimit: 4 * 1024 ** 3 })).toBe(4 * 1024 ** 3);
    expect(memoryCapBytes({ deviceMemoryGb: 4 })).toBe(2 * 1024 ** 3);
    expect(memoryCapBytes({ jsHeapSizeLimit: 4 * 1024 ** 3, deviceMemoryGb: 2 })).toBe(1024 ** 3);
  });
});
