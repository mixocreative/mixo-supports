import { describe, expect, it } from 'vitest';
import { assertGenerateMemory, assertMemoryCapacity, assertPlateCapacity, assertTriangleCapacity, CapacityError, estimateGenerateBytes, estimateImportBytes, PlateFullError, FULL_TIER_MAX, memoryCapBytes, meshTier, refusalLimit, TRIANGLE_BUDGET } from './budget';

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

  it('calibrates Generate to the measured ~850 MiB per million triangles', () => {
    expect(estimateGenerateBytes(2_000_000) / 2 ** 30).toBeCloseTo(1.66, 1);
    expect(estimateGenerateBytes(5_000_000) / 2 ** 30).toBeCloseTo(4.15, 1);
  });

  it('trusts the 6M job gate when deviceMemory is missing or 8 (clamped: unknown or large)', () => {
    expect(() => assertGenerateMemory(6_000_000, 'web', undefined)).not.toThrow();
    expect(() => assertGenerateMemory(5_000_000, 'web', 8)).not.toThrow(); // the 5M fixture generates on Chrome
    expect(() => assertGenerateMemory(6_000_000, 'web', 8)).not.toThrow();
  });

  it('refuses a Generate needing more than half of a small reported device memory (4 GB or less)', () => {
    expect(() => assertGenerateMemory(2_000_000, 'web', 4)).not.toThrow();
    try {
      assertGenerateMemory(3_000_000, 'web', 4);
      expect.unreachable();
    } catch (error) {
      expect((error as CapacityError).code).toBe('out-of-memory');
      expect((error as CapacityError).vars.limit).toBe(Math.floor(2 * 2 ** 30 / Math.round(850 * 2 ** 20 / 1e6)));
    }
  });

  it('names the triangles memory allows when an import is over the memory cap', () => {
    try {
      assertMemoryCapacity('x.stl', 30_000_000, 'web', 2 ** 30);
      expect.unreachable();
    } catch (error) {
      expect((error as CapacityError).code).toBe('out-of-memory');
      expect((error as CapacityError).vars.limit).toBeLessThan(30_000_000);
    }
  });

  it('refuses an import that would put more than the refusal limit on the plate', () => {
    expect(() => assertPlateCapacity('a.stl', refusalLimit('web'), 'web')).not.toThrow();
    expect(() => assertPlateCapacity('C:/x/a.stl', refusalLimit('web') + 1, 'web')).toThrow(PlateFullError);
    try {
      assertPlateCapacity('C:/x/a.stl', 7_000_000, 'web');
    } catch (error) {
      expect(error).toMatchObject({ code: 'plate-full', fileName: 'a.stl', vars: { n: 7_000_000, limit: refusalLimit('web') } });
    }
  });
});
