import { describe, expect, it } from 'vitest';
import { buildTreeTopology, type TreeAnchor } from './tree';

const anchor = (id: string, x: number, y: number, z = 0): TreeAnchor => ({ id, position: [x, y, z] });

describe('buildTreeTopology', () => {
  it('merges nearby anchors into branches, a junction and one trunk', () => {
    const contacts = [anchor('a', 0, 10), anchor('b', 2, 9), anchor('c', 40, 10)];
    const records = buildTreeTopology(contacts, { mergeDistance: 5, branchDescent: 3 });

    expect(records).toContainEqual(expect.objectContaining({ kind: 'branch' }));
    const junction = records.find((record) => record.kind === 'junction')!;
    expect(junction).toMatchObject({ contactIds: ['a', 'b'] });
    expect(junction.position[1]).toBeCloseTo(6);
    expect(junction.position[0]).toBeCloseTo(1);
    expect(records.filter((record) => record.kind === 'branch')).toHaveLength(2);
    expect(records.filter((record) => record.kind === 'trunk')).toEqual([
      expect.objectContaining({ junctionId: junction.id, memberCount: 2, to: [1, 0, 0] }),
    ]);
    expect(records).toContainEqual(expect.objectContaining({ kind: 'pillar', contactId: 'c' }));
  });

  it('is deterministic and keeps pillars when the junction would reach the plate', () => {
    const contacts = [anchor('a', 0, 2), anchor('b', 1, 2)];
    const options = { mergeDistance: 5, branchDescent: 3, floor: 0.5 };

    expect(buildTreeTopology(contacts, options)).toEqual(buildTreeTopology(contacts, options));
    expect(buildTreeTopology(contacts, options).map((record) => record.kind)).toEqual(['pillar', 'pillar']);
  });
});
