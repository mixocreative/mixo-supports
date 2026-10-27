import { describe, expect, it } from 'vitest';
import { nodeEngine } from '../../scripts/test-support/rustImport';
import type { SupportContact } from '../core/supports/mesh';
import { defaultSupportSettings, setRoofMode, updateSetting, type LiveSupportSettings } from '../core/supports/settings';
import { SETTINGS_ORDER, buildSupportsWasm, engineSettingsLayout } from '../supports/supportBuildWasm';
import { alignerScenario, compareBuilds, fixtureScenarios, landingDifferences, landsOnExactSurface, remeshOf, rustBuild, rustInputs, tsBuild, withRustModel, withStructures, type Scenario } from '../../scripts/test-support/supportParityHarness';

/*
 * U4a-U4c + U5: the Rust support builder (tip, neck, pillar, foot, Auto Tree, Brace, raft, label, Roof,
 * Cage) against the TS builder (the oracle, scripts/test-support/ts-oracle/support-builder, with its
 * own voxel remesh) fed the SAME contacts; Rust samples the neck normals, lands on the remesh and lays
 * out the Auto Trees (Safe Distance included) itself. Rule 7: indices and tags identical, positions
 * within 1e-5 mm.
 */

let landedColumns = 0;
let totalComponents = 0;
const seen = { parts: new Set<string>(), treeBranch: 0, treeTrunk: 0, treeNeck: 0, brace: 0, treeLanded: 0, casts: 0, hits: 0, exactBuilds: 0 };

function check(scenario: Scenario): void {
  const remesh = remeshOf(scenario);
  const ts = tsBuild(scenario, remesh);
  const inputs = rustInputs(scenario);
  const rust = rustBuild(scenario, inputs);
  expect(ts.components.length, `${scenario.name} builds something`).toBeGreaterThan(0);
  expect(compareBuilds(ts, rust, inputs), scenario.name).toEqual([]);
  // Rule 7 on the landing rays themselves: the Rust exact-surface cast equals the TS one on every neck and junction.
  const landings = landingDifferences(scenario, inputs);
  expect(landings.differences, `${scenario.name} landings`).toEqual([]);
  totalComponents += ts.components.length;
  landedColumns += ts.components.filter((c) => c.landingReach !== undefined).length;
  seen.casts += landings.casts;
  seen.hits += landings.hits;
  seen.exactBuilds += landsOnExactSurface(scenario) ? 1 : 0;
  seen.treeLanded += ts.components.filter((c) => c.contactIntent?.some((i) => i.kind === 'secondary')).length;
  for (const c of ts.components) {
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

  it('rejects malformed host input (landing-rule flag shapes) with typed errors', () => {
    const contacts = [{ id: 'a', position: [0, 8, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], origin: 'auto' as const }];
    const settings = withStructures({ ...defaultSupportSettings, roofSeededModes: [] });
    const run = (options: Parameters<typeof buildSupportsWasm>[4]) => () => withRustModel(sample(), (session, model) => buildSupportsWasm(session, contacts, settings, 'export', { model, ...options }));
    expect(run({ rejectedColumns: [true, false] })).toThrowError(expect.objectContaining({ code: 'BAD_INPUT' }));
    expect(run({ rejectedColumns: [true] })).not.toThrow();
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
    ['safe distance 0.5 (scatter remesh)', (s) => updateSetting(updateSetting(updateSetting(s, 'scatterAutoTree', true), 'scatterMergeDistance', 5), 'scatterSafeDistance', 0.5)],
    ['label AB-12 (digits and dash)', (s) => s],
    ['raft off, label on', (s) => updateSetting(s, 'raftEnabled', false)],
    ['raft wall angle 25, tall wall, thick floor', (s) => updateSetting(updateSetting(updateSetting(s, 'raftWallAngle', 25), 'raftWallHeight', 6), 'raftFloorThickness', 1.6)],
    ['raft narrow expand, low voxel resolution', (s) => updateSetting(updateSetting(s, 'raftExpandWidth', 1.5), 'voxelResolution', 24)],
    ['label letter size 6, margin 1, offset', (s) => updateSetting(updateSetting(updateSetting(updateSetting(s, 'labelSize', 6), 'labelMargin', 1), 'labelOffsetX', 2), 'labelOffsetY', -1.5)],
    ['roof with diagonals and concentric braces', (s) => updateSetting(updateSetting(updateSetting(setRoofMode(s, 'ROOF'), 'diagonalEnabled', true), 'braceConcentric', 3), 'columnCount', 10)],
    ['roof open ceiling', (s) => updateSetting(setRoofMode(s, 'ROOF'), 'storeyEncloseCeiling', false)],
    ['cage', (s) => setRoofMode(s, 'CAGE')],
    ['cage with diagonals, raft off', (s) => updateSetting(updateSetting(setRoofMode(s, 'CAGE'), 'diagonalEnabled', true), 'raftEnabled', false)],
    ['brace only, long distance limit', (s) => ({ ...updateSetting(s, 'trussDistanceLimit', 30), scatterAutoTree: false, trussEnabled: true })],
  ];
  for (const scenario of base) {
    for (const [label, change] of variants) {
      it(`${scenario.name}: ${label}`, () => check({ ...scenario, name: `${scenario.name} ${label}`, settings: change(scenario.settings), ...(label.startsWith('label AB') ? { labelText: 'AB-12' } : {}) }), 60_000);
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
