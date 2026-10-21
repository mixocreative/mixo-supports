import { describe, expect, it } from 'vitest';
import type { PrintUnit } from '../state/project';
import { deleteCommands } from './selection';

describe('deleteCommands', () => {
  const unit = { id: 'u1', manual: [{ id: 'manual-a' }] } as unknown as PrintUnit;

  it('removes manual contacts and deletes the rest in one command', () => {
    expect(deleteCommands(unit, ['manual-a', 'auto-x', 'auto-y'])).toEqual([
      { type: 'manual/remove', unitId: 'u1', pointId: 'manual-a' },
      { type: 'deletion/add', unitId: 'u1', pointIds: ['auto-x', 'auto-y'] },
    ]);
  });

  it('returns nothing for no ids', () => {
    expect(deleteCommands(unit, [])).toEqual([]);
  });

  it('a manual-only selection adds no deletion', () => {
    expect(deleteCommands(unit, ['manual-a'])).toEqual([{ type: 'manual/remove', unitId: 'u1', pointId: 'manual-a' }]);
  });

  it('duplicate ids give no duplicate commands or point ids', () => {
    expect(deleteCommands(unit, ['manual-a', 'auto-x', 'manual-a', 'auto-x'])).toEqual([
      { type: 'manual/remove', unitId: 'u1', pointId: 'manual-a' },
      { type: 'deletion/add', unitId: 'u1', pointIds: ['auto-x'] },
    ]);
  });
});
