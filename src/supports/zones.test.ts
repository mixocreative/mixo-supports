import { describe, expect, it } from 'vitest';
import { nextStamp, stampVertices, zonedAt, zonedVertices, type ZoneStamp } from './zones';

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

describe('zonedVertices', () => {
  // Four vertices on a line along x, normals down except the last (up: the far side of a wall).
  const positions = new Float32Array([0, 0, 0, 1.5, 0, 0, 3, 0, 0, 0.5, 0, 0]);
  const normals = new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0]);
  const at = (center: ZoneStamp['center'], kind: ZoneStamp['kind'], radius = 2): ZoneStamp => ({ center, radius, normal: [0, -1, 0], kind });

  it('marks the vertices zonedAt calls zoned', () => {
    const zones = [at([0, 0, 0], 'paint'), at([3, 0, 0], 'paint', 1), at([1.5, 0, 0], 'erase', 0.5)];
    const out = zonedVertices(zones, positions, normals);
    const expected = [0, 1, 2, 3].map((v) => (zonedAt(zones, [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!], [normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!]) ? 1 : 0));
    expect([...out]).toEqual(expected);
    expect([...out]).toEqual([1, 0, 1, 0]);
  });

  it('clears a reused output array first', () => {
    const out = new Uint8Array([1, 1, 1, 1]);
    expect(zonedVertices([], positions, normals, out)).toBe(out);
    expect([...out]).toEqual([0, 0, 0, 0]);
  });
});

describe('stampVertices', () => {
  it('applying stamps one by one matches zonedVertices', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const normals = new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]);
    const zones: ZoneStamp[] = [
      { center: [0, 0, 0], radius: 1.5, normal: [0, -1, 0], kind: 'paint' },
      { center: [2, 0, 0], radius: 1, normal: [0, -1, 0], kind: 'paint' },
      { center: [0, 0, 0], radius: 0.5, normal: [0, -1, 0], kind: 'erase' },
    ];
    const out = new Uint8Array(3);
    for (const stamp of zones) stampVertices(stamp, positions, normals, out);
    expect([...out]).toEqual([...zonedVertices(zones, positions, normals)]);
    expect([...out]).toEqual([0, 1, 1]);
  });
});
