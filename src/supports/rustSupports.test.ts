import { describe, expect, it } from 'vitest';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { defaultSupportSettings } from '../core/supports/settings';
import { expectGolden } from '../../scripts/test-support/golden';
import { buildSnapshot } from '../../scripts/test-support/buildSnapshot';
import { goldenName } from '../../scripts/test-support/supportParityHarness';
import { CASES, type Case } from '../../scripts/test-support/rustSupportsCases';
import { buildSupportMesh } from './rustSupports';

/*
 * The Rust build (zones and a per-face landing mask as data) against the results of the TS builder
 * it replaced, recorded in scripts/fixtures/golden/rustSupports/ (U9; cases in scripts/test-support/rustSupportsCases.ts): rule 7 (indices, tags, dropped lists identical,
 * positions within 1e-5 mm) on the cases the Rust ABI alone cannot see: no-support zones, landing
 * rules, tips-only previews, trees blocked by either, and an Auto Tree Safe Distance.
 */

function same(testCase: Case): GeneratedSupportMesh {
  const { landingAllowed, ...rest } = testCase.options;
  // The production rule is data: the face predicate of the recorded case becomes a per-face mask.
  const faces = testCase.options.model ? testCase.options.model.indices.length / 3 : 0;
  const landingFaces = landingAllowed ? Uint8Array.from({ length: faces }, (_, face) => (landingAllowed({ faceIndex: face }) ? 1 : 0)) : undefined;
  const rust = buildSupportMesh(testCase.contacts, testCase.settings, { ...rest, ...(landingFaces ? { landingFaces } : {}) } as never);
  expectGolden(goldenName(testCase.name, 'rustSupports'), buildSnapshot({ ...rust, droppedByZones: rust.droppedByZones }));
  return rust;
}

const byName = (name: string) => CASES.find((c) => c.name === name)!;

describe('production build against the recorded TS builder: a column landing in a zone or on a forbidden face', () => {
  it.each(CASES.filter((c) => c.name.startsWith('slab ') && !['slab manual never dropped', 'slab zoned column drops'].includes(c.name)).map((c) => [c.name]))('%s', (name) => {
    same(byName(name!));
  });

  it('never drops a manual support', () => {
    expect(same(byName('slab manual never dropped')).dropped).toEqual([]);
  });

  it('actually drops the zoned column (not a vacuous comparison)', () => {
    expect(same(byName('slab zoned column drops')).dropped).toEqual(['auto-shelf']);
  });
});

describe('production build against the recorded TS builder: Auto Trees blocked by a zone or a landing rule', () => {
  it('a zone on the landing drops the tree members, as a preview and tips-only', () => {
    expect(same(byName('tree zone preview')).dropped).toEqual(['auto--0.9', 'auto-0.9']);
    same(byName('tree zone tips-only'));
  });

  it('a forbidden landing face drops the tree members', () => {
    expect(same(byName('tree forbidden face')).dropped.length).toBeGreaterThan(0);
  });

  it('the remeshed export builds and drops the same', () => {
    same(byName('tree remeshed export'));
  });

  it('Safe Distance uses the host layout and matches', () => {
    same(byName('tree safe distance'));
  });
});

describe('production build: empty input and no model', () => {
  it('an empty contact list builds an empty mesh without touching the engine', () => {
    const built = buildSupportMesh([], defaultSupportSettings);
    expect(built.indices.length).toBe(0);
    expect(built.dropped).toEqual([]);
  });

  it('builds without a model like the recorded builder (raft from the column feet)', () => {
    same(byName('no model'));
  });
});
