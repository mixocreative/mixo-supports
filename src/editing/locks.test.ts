import { describe, expect, it } from 'vitest';
import { lockNote, sectionLocked } from './locks';

describe('panel locks', () => {
  it('locks nothing outside the modes', () => {
    for (const section of ['import', 'objects', 'transform', 'supports', 'check', 'settings', 'export'] as const) expect(sectionLocked(section, 'off')).toBe(false);
    expect(lockNote('left', 'off')).toBeUndefined();
  });

  it('Support Edit Mode locks the left panel but Check, and leaves the right panel live', () => {
    expect(['import', 'objects', 'transform', 'supports'].every((s) => sectionLocked(s as 'import', 'edit'))).toBe(true);
    expect(sectionLocked('check', 'edit')).toBe(false);
    expect(sectionLocked('settings', 'edit')).toBe(false);
    expect(sectionLocked('export', 'edit')).toBe(false);
    expect(lockNote('left', 'edit')).toEqual({ key: 'Finish editing supports first: press Esc or Done.' });
    expect(lockNote('right', 'edit')).toBeUndefined();
  });

  it('zones locks every section of both panels', () => {
    for (const section of ['import', 'objects', 'transform', 'supports', 'check', 'settings', 'export'] as const) expect(sectionLocked(section, 'zones')).toBe(true);
    expect(lockNote('right', 'zones')).toEqual({ key: 'Finish painting zones first: press Esc or Done.' });
  });
});

describe('dental flow locks', () => {
  it('dims every section of both panels, like zones', () => {
    for (const section of ['import', 'objects', 'transform', 'supports', 'check', 'settings', 'export'] as const) expect(sectionLocked(section, 'dental')).toBe(true);
    expect(lockNote('left', 'dental')).toBeDefined();
    expect(lockNote('right', 'dental')).toBeDefined();
  });
});
