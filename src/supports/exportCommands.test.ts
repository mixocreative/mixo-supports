import { describe, expect, it } from 'vitest';
import { COMMAND_IDS } from '../editing/commands';
import { emptyScene } from '../state/project';
import { exportUnits, type ExportKind } from './export';

describe('the Export STL commands', () => {
  it('are named for the export kinds the planner knows', () => {
    const kinds = COMMAND_IDS.filter((id) => id.startsWith('export.')).map((id) => id.slice('export.'.length) as ExportKind);
    expect(kinds).toHaveLength(5);
    for (const kind of kinds) expect(exportUnits(emptyScene, kind), kind).toEqual([]);
  });
});
