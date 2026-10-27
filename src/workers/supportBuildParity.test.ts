import { describe, expect, it } from 'vitest';
import { nodeEngine } from '../../scripts/test-support/rustImport';
import type { SupportContact } from '../core/supports/mesh';
import { defaultSupportSettings, updateSetting, type LiveSupportSettings } from '../core/supports/settings';
import { SETTINGS_ORDER, buildSupportsWasm, engineSettingsLayout } from '../../scripts/test-support/supportBuildWasm';
import { alignerScenario, compareBuilds, fixtureScenarios, landingDifferences, landsOnExactSurface, remeshOf, rustBuild, rustInputs, treeLandingsOf, tsBuild, withRustModel, withoutStructures, type Scenario } from '../../scripts/test-support/supportParityHarness';

/*
 * U4a: the Rust column builder (tip, neck, pillar, foot) against the TS builder fed the SAME
 * contacts, with Tree / Brace / raft / roof / cage off. Rule 7: indices and tags identical,
 * positions within 1e-5 mm. TS stays in production until the whole builder cuts over.
 */

let landedColumns = 0;
let totalComponents = 0;
const seen = { treeBranch: 0, treeTrunk: 0, treeNeck: 0, brace: 0, treeLanded: 0, casts: 0, hits: 0, exactBuilds: 0 };

function check(scenario: Scenario): void {
  const remesh = remeshOf(scenario);
  const ts = tsBuild(scenario, remesh);
  const inputs = rustInputs(scenario, remesh);
  const trees = treeLandingsOf(scenario, remesh);
  const rust = rustBuild(scenario, inputs, trees);
  expect(ts.components.length, `${scenario.name} builds something`).toBeGreaterThan(0);
  expect(compareBuilds(ts, rust, inputs), scenario.name).toEqual([]);
  // Rule 7 on the landing rays themselves: the Rust exact-surface cast equals the TS one on every neck and junction.
  const landings = landingDifferences(scenario, inputs, trees);
  expect(landings.differences, `${scenario.name} landings`).toEqual([]);
  totalComponents += ts.components.length;
  landedColumns += inputs.filter((c) => c.landing).length;
  seen.casts += landings.casts;
  seen.hits += landings.hits;
  seen.exactBuilds += landsOnExactSurface(scenario) ? 1 : 0;
  seen.treeLanded += trees.filter((t) => t.hit).length;
  for (const c of ts.components) {
    if (c.part === 'tree-branch') seen.treeBranch += 1;
    if (c.part === 'tree-trunk') seen.treeTrunk += 1;
    if (c.part === 'neck' && c.structureKind === 'tree') seen.treeNeck += 1;
    if (c.part === 'brace') seen.brace += 1;
  }
}

const sample = (): Scenario => fixtureScenarios('export')[0]!;

describe('engine contract', () => {
  it('the host settings packer has the order the engine reads', () => {
    expect(engineSettingsLayout(nodeEngine)).toEqual([...SETTINGS_ORDER]);
  });

  it('Roof, Cage and Raft are typed NOT_YET_PORTED errors, never partial geometry', () => {
    const contacts = [{ id: 'a', position: [0, 8, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], origin: 'auto' as const }];
    const base = withoutStructures({ ...defaultSupportSettings, roofSeededModes: [] });
    const run = (settings: LiveSupportSettings) => () => withRustModel(sample(), (session) => buildSupportsWasm(session, contacts, settings, 'export'));
    expect(run({ ...base, raftEnabled: true })).toThrowError(expect.objectContaining({ code: 'NOT_YET_PORTED', detail: 'Raft' }));
    expect(run({ ...base, roofMode: 'ROOF' })).toThrowError(expect.objectContaining({ detail: 'Roof' }));
    expect(run({ ...base, roofMode: 'CAGE' })).toThrowError(expect.objectContaining({ detail: 'Cage' }));
    expect(run({ ...base, scatterAutoTree: true, trussEnabled: true })).not.toThrow();
    expect(run(base)).not.toThrow();
  });

  it('Auto Tree with Safe Distance needs the voxel remesh (U5): a typed error', () => {
    const contacts = [{ id: 'a', position: [0, 8, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], origin: 'auto' as const }];
    const settings = { ...withoutStructures({ ...defaultSupportSettings, roofSeededModes: [] }), scatterAutoTree: true, scatterSafeDistance: 0.5 };
    expect(() => withRustModel(sample(), (session, model) => buildSupportsWasm(session, contacts, settings, 'export', { model }))).toThrowError(expect.objectContaining({ code: 'NOT_YET_PORTED', detail: 'Tree' }));
  });

  it('rejects a setting outside its validated range with a typed error', () => {
    const base = withoutStructures({ ...defaultSupportSettings, roofSeededModes: [] });
    expect(() => withRustModel(sample(), (session) => buildSupportsWasm(session, [], { ...base, resolution: 2 }, 'export'))).toThrowError(expect.objectContaining({ code: 'SETTING_OUT_OF_RANGE', detail: 'resolution' }));
  });
});

describe('golden fixtures: every variant, preview and export (Tree and Brace as each variant configures them)', () => {
  for (const mode of ['preview', 'export'] as const) {
    for (const scenario of fixtureScenarios(mode)) {
      it(scenario.name, () => check(scenario), 60_000);
    }
  }
});

describe('settings and per-support shapes that reach other column code paths', () => {
  const base = fixtureScenarios('export').filter((s) => s.name.startsWith('cube-overhang.default') || s.name.startsWith('knot.default'));
  const variants: [string, (s: LiveSupportSettings) => LiveSupportSettings][] = [
    ['contact sphere', (s) => updateSetting(updateSetting(s, 'contactShape', 'SPHERE'), 'touchDepth', 0.1)],
    ['square tapered tip', (s) => updateSetting(s, 'tipSection', 'SQUARE')],
    ['cross straight tip', (s) => updateSetting(updateSetting(s, 'tipSection', 'CROSS'), 'tipProfile', 'STRAIGHT')],
    ['round straight tip', (s) => updateSetting(s, 'tipProfile', 'STRAIGHT')],
    ['sphere + square', (s) => updateSetting(updateSetting(s, 'contactShape', 'SPHERE'), 'tipSection', 'SQUARE')],
    ['tall neck, steep angle, resolution 20', (s) => updateSetting(updateSetting(updateSetting(s, 'neckLength', 4), 'maxNeckAngle', 10), 'resolution', 20)],
    ['raft off but high lift floor', (s) => updateSetting(s, 'baseHeight', 2.5)],
    ['tree + brace, wide merge', (s) => updateSetting(updateSetting(updateSetting(s, 'scatterAutoTree', true), 'trussEnabled', true), 'scatterMergeDistance', 6)],
    ['tree only', (s) => ({ ...updateSetting(updateSetting(s, 'scatterAutoTree', true), 'scatterMergeDistance', 4), trussEnabled: false })],
    ['tree + sphere + square tips', (s) => updateSetting(updateSetting(updateSetting(updateSetting(s, 'scatterAutoTree', true), 'scatterMergeDistance', 5), 'contactShape', 'SPHERE'), 'tipSection', 'SQUARE')],
    ['tree + straight tips, 3 percent increment', (s) => updateSetting(updateSetting(updateSetting(updateSetting(s, 'scatterAutoTree', true), 'scatterMergeDistance', 5), 'tipProfile', 'STRAIGHT'), 'treeSectionIncrement', 3)],
    ['tree descent 6, brace angle 30', (s) => updateSetting(updateSetting(updateSetting(updateSetting(s, 'scatterAutoTree', true), 'scatterMergeDistance', 5), 'scatterBranchDescent', 6), 'trussAngle', 30)],
    ['brace only, long distance limit', (s) => ({ ...updateSetting(s, 'trussDistanceLimit', 30), scatterAutoTree: false, trussEnabled: true })],
  ];
  for (const scenario of base) {
    for (const [label, change] of variants) {
      it(`${scenario.name}: ${label}`, () => check({ ...scenario, name: `${scenario.name} ${label}`, settings: change(scenario.settings) }), 60_000);
    }
    it(`${scenario.name}: tips-only preview`, () => check({ ...scenario, name: `${scenario.name} tips-only`, mode: 'preview', settings: { ...scenario.settings, previewMode: 'ONLY_TIP' } }), 60_000);
    it(`${scenario.name}: manual contacts and own shapes`, () => {
      const contacts = scenario.contacts.map((c, i): SupportContact => i % 3 === 0
        ? { ...c, origin: 'manual', shape: i % 2 === 0 ? { contactShape: 'SPHERE', touchDiameter: 0.9, touchDepth: 0.1 } : { tipSection: 'CROSS', pointDiameter: 0.4, neckLength: 3 } }
        : c);
      check({ ...scenario, name: `${scenario.name} manual+shapes`, contacts });
    }, 60_000);
  }
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
