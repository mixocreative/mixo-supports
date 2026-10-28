import { describe, expect, it } from 'vitest';
import { nodeEngine } from '../../scripts/test-support/rustImport';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import { SETTINGS_ORDER } from '../supports/supportBuildWasm';
import { buildSupportsWasm, engineSettingsLayout } from '../../scripts/test-support/supportBuildCall';
import { expectGolden } from '../../scripts/test-support/golden';
import { alignerScenario, fixtureScenarios, goldenName, landsOnExactSurface, originMismatches, rustBuild, rustInputs, landingSnapshot, rustLandingHits, rustSnapshot, variantScenarios, withRustModel, withStructures, type Scenario } from '../../scripts/test-support/supportParityHarness';

/*
 * U4a-U4c + U5: the Rust support builder (tip, neck, pillar, foot, Auto Tree, Brace, raft, label, Roof,
 * Cage) against the results the TS builder (the former oracle, with its own voxel remesh) produced for the
 * SAME contacts, recorded in scripts/fixtures/golden/builder/ (U9); Rust samples the neck normals, lands on
 * the remesh and lays out the Auto Trees (Safe Distance included) itself. Rule 7: indices and tags identical,
 * positions within 1e-5 mm. Regenerate with UPDATE_GOLDENS=1 (scripts/test-support/golden.ts).
 */

let landedColumns = 0;
let totalComponents = 0;
const seen = { parts: new Set<string>(), treeBranch: 0, treeTrunk: 0, treeNeck: 0, brace: 0, treeLanded: 0, casts: 0, hits: 0, exactBuilds: 0 };

function check(scenario: Scenario): void {
  const inputs = rustInputs(scenario);
  const rust = rustBuild(scenario, inputs);
  expect(rust.components.length, `${scenario.name} builds something`).toBeGreaterThan(0);
  expect(originMismatches(rust, inputs), scenario.name).toEqual([]);
  // Rule 7 on the landing rays themselves: the Rust exact-surface cast against the recorded TS one on every neck.
  const hits = rustLandingHits(scenario, inputs);
  const landings = landingSnapshot(hits);
  expectGolden(goldenName(scenario.name), { build: rustSnapshot(rust, inputs), landings, components: rust.components.length });
  totalComponents += rust.components.length;
  landedColumns += rust.components.filter((c) => c.landingReach !== undefined).length;
  seen.casts += landings.faces.count;
  seen.hits += hits.filter(Boolean).length;
  seen.exactBuilds += landsOnExactSurface(scenario) ? 1 : 0;
  seen.treeLanded += rust.components.filter((c) => c.contactIntent?.some((i) => i.kind === 'secondary')).length;
  for (const c of rust.components) {
    seen.parts.add(c.part);
    if (c.part === 'tree-branch') seen.treeBranch += 1;
    if (c.part === 'tree-trunk') seen.treeTrunk += 1;
    if (c.part === 'neck' && c.structureKind === 'tree') seen.treeNeck += 1;
    if (c.part === 'brace') seen.brace += 1;
  }
}

let sampled: Scenario | undefined;
const sample = (): Scenario => (sampled ??= fixtureScenarios('export')[0]!);

describe('engine contract', () => {
  it('the host settings packer has the order the engine reads', () => {
    expect(engineSettingsLayout(nodeEngine)).toEqual([...SETTINGS_ORDER]);
  });

  it('builds Raft, Roof, Cage and the label (a model gives the outline), none of them stubs', () => {
    const contacts = [{ id: 'a', position: [0, 8, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], origin: 'auto' as const }];
    const base = withStructures({ ...defaultSupportSettings, roofSeededModes: [] });
    const run = (settings: LiveSupportSettings) => withRustModel(sample(), (session, model) => buildSupportsWasm(session, contacts, settings, 'export', { model, labelText: 'A' }).components.map((c) => c.part));
    expect(run({ ...base, raftEnabled: true })).toEqual(expect.arrayContaining(['raft', 'label']));
    expect(run({ ...base, raftEnabled: false })).not.toContain('raft');
    expect(run({ ...base, roofMode: 'ROOF' })).toEqual(expect.arrayContaining(['column', 'roof']));
    expect(run({ ...base, roofMode: 'CAGE' })).toContain('cage-ring');
  });

  it('rejects a landing mask that does not match the model with a typed error', () => {
    const contacts = [{ id: 'a', position: [0, 8, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], origin: 'auto' as const }];
    const settings = withStructures({ ...defaultSupportSettings, roofSeededModes: [] });
    const run = (options: Parameters<typeof buildSupportsWasm>[4]) => () => withRustModel(sample(), (session, model) => buildSupportsWasm(session, contacts, settings, 'export', { model, ...options }));
    expect(run({ landingFaces: new Uint8Array(1) })).toThrowError(expect.objectContaining({ code: 'BAD_INPUT' }));
    expect(run({})).not.toThrow();
  });

  it('rejects a setting outside its validated range with a typed error', () => {
    const base = withStructures({ ...defaultSupportSettings, roofSeededModes: [] });
    expect(() => withRustModel(sample(), (session) => buildSupportsWasm(session, [], { ...base, resolution: 2 }, 'export'))).toThrowError(expect.objectContaining({ code: 'SETTING_OUT_OF_RANGE', detail: 'resolution' }));
  });
});

describe('golden fixtures: every variant, preview and export (Tree, Brace, raft, label, Roof as each variant configures them)', () => {
  for (const mode of ['preview', 'export'] as const) {
    for (const scenario of fixtureScenarios(mode)) {
      it(scenario.name, () => check(scenario), 60_000);
    }
  }
});

describe('settings and per-support shapes that reach other column code paths', () => {
  for (const scenario of variantScenarios()) it(scenario.name, () => check(scenario), 60_000);
});

describe('reference aligner dental contacts', () => {
  it.each([['preview', true], ['export', false]] as const)('%s (low-poly %s)', (mode, lowPoly) => {
    const scenario = alignerScenario(mode, lowPoly);
    expect(scenario, 'the region detector proposes contacts on the reference').toBeDefined();
    expect(scenario!.contacts.length).toBeGreaterThan(20);
    check(scenario!);
  }, 900_000);
});

describe('not vacuous', () => {
  it('compared raft, label, roof, cage and their sub-parts', () => {
    for (const part of ['raft', 'label', 'roof', 'column', 'roof-brace', 'cross-bar', 'cage-ring']) expect(seen.parts.has(part), part).toBe(true);
  });

  it('compared Auto Tree branches, trunks, tree necks, tree landings, braces and landing rays', () => {
    expect(seen.treeBranch).toBeGreaterThan(0);
    expect(seen.treeTrunk).toBeGreaterThan(0);
    expect(seen.treeNeck).toBeGreaterThan(0);
    expect(seen.treeLanded).toBeGreaterThan(0);
    expect(seen.brace).toBeGreaterThan(0);
    expect(seen.casts).toBeGreaterThan(100);
    expect(seen.hits).toBeGreaterThan(0);
    expect(seen.exactBuilds, 'Rust cast its own landings in the Low Poly previews').toBeGreaterThan(0);
  });

  it('compared real geometry, including columns that land on the model', () => {
    expect(totalComponents).toBeGreaterThan(500);
    expect(landedColumns).toBeGreaterThan(0);
  });
});
