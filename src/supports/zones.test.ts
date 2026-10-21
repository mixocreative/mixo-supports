import { describe, expect, it } from 'vitest';
import { nextStamp, zonedAt, type ZoneStamp } from './zones';

const stamp = (kind: ZoneStamp['kind'], normal: ZoneStamp['normal'] = [0, -1, 0]): ZoneStamp => ({ center: [0, 0, 0], radius: 2, normal, kind });

describe('zonedAt', () => {
  it('is false without stamps', () => {
    expect(zonedAt([], [0, 0, 0])).toBe(false);
  });

  it('covers inside and on the boundary of a paint stamp, not outside', () => {
    const zones = [stamp('paint')];
    expect(zonedAt(zones, [1, 0, 0], [0, -1, 0])).toBe(true);
    expect(zonedAt(zones, [2, 0, 0], [0, -1, 0])).toBe(true);
    expect(zonedAt(zones, [2.01, 0, 0], [0, -1, 0])).toBe(false);
  });

  it('ignores the opposite side of a thin wall', () => {
    expect(zonedAt([stamp('paint')], [0, 0, 0], [0, 1, 0])).toBe(false);
  });

  it('skips the side test when no normal is given', () => {
    expect(zonedAt([stamp('paint')], [0, 0, 0])).toBe(true);
  });

  it('lets the last covering stamp decide', () => {
    expect(zonedAt([stamp('paint'), stamp('erase')], [0, 0, 0], [0, -1, 0])).toBe(false);
    expect(zonedAt([stamp('erase'), stamp('paint')], [0, 0, 0], [0, -1, 0])).toBe(true);
  });
});

describe('nextStamp', () => {
  it('stamps first, then once the pointer moved half a radius', () => {
    expect(nextStamp(undefined, [0, 0, 0], 2)).toBe(true);
    expect(nextStamp([0, 0, 0], [0.9, 0, 0], 2)).toBe(false);
    expect(nextStamp([0, 0, 0], [1, 0, 0], 2)).toBe(true);
  });
});
