import { describe, expect, it } from 'vitest';
import { GOLDEN_FIXTURES } from './fixtures';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { unitSupportMesh } from '../supports/unitSupports';
import { assertFinite, goldenDiff, goldenName, goldenSnapshot, supportedUnit } from './pipeline';

/** Stored snapshots, written only by `npx vite-node scripts/update-goldens.ts`. */
const STORED = import.meta.glob<string>(['./__snapshots__/*.json'], { query: '?raw', import: 'default', eager: true });

describe('golden fixtures', () => {
  for (const fixture of GOLDEN_FIXTURES) {
    for (const variant of fixture.variants) {
      const name = goldenName(fixture, variant);
      const change = fixture.expectedChanges?.[variant];
      it(`reproduces ${name} exactly${change ? ` (expected to change in ${change})` : ''}`, () => {
        const stored = STORED[`./__snapshots__/${name}.json`];
        expect(stored, `missing snapshot ${name}.json (run npx vite-node scripts/update-goldens.ts)`).toBeDefined();
        // Round-trip through JSON so the comparison sees exactly what a snapshot can hold.
        const snapshot = goldenSnapshot(fixture, variant);
        assertFinite(snapshot);
        const actual: unknown = JSON.parse(JSON.stringify(snapshot));
        const differences = goldenDiff(JSON.parse(stored!), actual);
        expect(differences, `${name} differs from its golden:\n${differences.join('\n')}`).toEqual([]);
      });
    }
  }
});

describe('a golden unit with two customised supports', () => {
  const plain = supportedUnit(GOLDEN_FIXTURES.find((fixture) => fixture.name === 'cube-overhang')!, 'default');
  const [a, b] = plain.placement!.points.map((point) => point.id);
  const customised = { ...plain, contactSettings: { [a!]: { pointDiameter: 0.5, neckLength: 3 }, [b!]: { pointDiameter: 0.5, neckLength: 3 } } };
  /** Triangles of one contact's components as vertex coordinates. */
  const geometryOf = (mesh: GeneratedSupportMesh, id: string) => mesh.components.filter((component) => component.contactId === id)
    .map((component) => Array.from(mesh.indices.slice(component.start, component.start + component.count), (index) => Array.from(mesh.positions.slice(index * 3, index * 3 + 3))));

  it('builds the same geometry for preview and export', () => {
    const preview = unitSupportMesh(customised, 0, 'preview');
    const exported = unitSupportMesh(customised, 0, 'export');
    expect(Array.from(exported.positions)).toEqual(Array.from(preview.positions));
    expect(Array.from(exported.indices)).toEqual(Array.from(preview.indices));
  });

  it('changes only the customised supports', () => {
    const before = unitSupportMesh(plain, 0, 'preview');
    const after = unitSupportMesh(customised, 0, 'preview');
    for (const id of [a!, b!]) expect(geometryOf(after, id)).not.toEqual(geometryOf(before, id));
    for (const { id } of plain.placement!.points.slice(2)) expect(geometryOf(after, id)).toEqual(geometryOf(before, id));
  });
});
