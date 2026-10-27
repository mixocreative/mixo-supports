import '../test-support/useNodeEngine';
/**
 * ONE-OFF RECORDER (U9, fork B). Ran the TS oracle (placement, support builder, voxel remesh, landing ray) and stored
 * its results in scripts/fixtures/golden/{builder,rustSupports,generic}/ for the Rust parity tests. It imports the
 * oracle, so it dies with scripts/test-support/ts-oracle; afterwards regenerate with UPDATE_GOLDENS=1 (golden.ts).
 *   npx vite-node scripts/golden/record-builder.ts
 */
import { readFileSync } from 'node:fs';
import { applyTransform } from '../../src/state/transform';
import { GOLDEN_FIXTURES } from '../../src/goldens/fixtures';
import { defaultSupportSettings } from '../../src/core/supports/settings';
import { writeGolden } from '../test-support/golden';
import { buildSnapshot } from '../test-support/buildSnapshot';
import { alignerScenario, fixtureScenarios, goldenName, landingSnapshot, landingSources, rustInputs, variantScenarios, type Scenario } from '../test-support/supportParityHarness';
import { CASES, boxes } from '../test-support/rustSupportsCases';
import { bookkeeping, bookkeepingSnapshot, placementSnapshot, settingsVariants } from '../test-support/genericCases';
import { buildSupportMesh } from './../test-support/ts-oracle/support-builder/mesh';
import { columnLanding, lineTarget } from '../test-support/ts-oracle/support-builder/landing';
import { RemeshTarget } from '../test-support/ts-oracle/remesh/remesh';
import * as placement from '../test-support/ts-oracle/placement/placement';

const exactOnly = (s: Scenario) => s.settings.lowPolyMode && s.mode === 'preview';
const remeshOf = (s: Scenario) => (exactOnly(s) ? undefined : new RemeshTarget(s.model, s.settings.pillarDiameter));

function recordScenario(scenario: Scenario): void {
  const started = performance.now();
  const ts = buildSupportMesh(scenario.contacts, scenario.settings, { mode: scenario.mode, model: scenario.model, ...(scenario.labelText ? { labelText: scenario.labelText } : {}), ...(remeshOf(scenario) ? { remesh: remeshOf(scenario)! } : {}) });
  const inputs = rustInputs(scenario);
  const exact = lineTarget(scenario.model, { ...scenario.settings, lowPolyMode: true }, undefined, false);
  const { sources } = landingSources(scenario, inputs);
  const hits = sources.map((from) => {
    const hit = exact.cast(from, exact.height);
    return hit ? { faceIndex: hit.faceIndex!, y: hit.point[1], normal: hit.normal } : undefined;
  });
  writeGolden(goldenName(scenario.name), { build: buildSnapshot({ ...ts, parts: undefined, droppedByZones: undefined }), landings: landingSnapshot(hits), components: ts.components.length });
  console.log(scenario.name, ts.components.length, `${Math.round(performance.now() - started)} ms`);
}

for (const mode of ['preview', 'export'] as const) for (const scenario of fixtureScenarios(mode)) recordScenario(scenario);
for (const scenario of variantScenarios()) recordScenario(scenario);
recordScenario(alignerScenario('preview', true)!);
recordScenario(alignerScenario('export', false)!);

for (const testCase of CASES) {
  const { landingAllowed, ...rest } = testCase.options;
  void rest;
  const ts = buildSupportMesh(testCase.contacts, testCase.settings, testCase.options as never);
  writeGolden(goldenName(testCase.name, 'rustSupports'), buildSnapshot({ ...ts, droppedByZones: ts.droppedByZones ?? [] }));
  void landingAllowed;
}

for (const fixture of GOLDEN_FIXTURES) {
  for (const [label, settings] of settingsVariants) {
    const turned = applyTransform(fixture.mesh, { position: [0, 0, 0], rotation: [...fixture.rotation] });
    writeGolden(goldenName(`${fixture.name}.${label}`, 'generic'), placementSnapshot(placement.generatePlacement(turned, settings)));
  }
}
void bookkeeping;
writeGolden('generic/bookkeeping', bookkeepingSnapshot({ ...placement, positionIds: (list: [number, number, number][]) => list.map((p) => placement.positionId(p)) } as never));

// jobRunner.test.ts literal: the landing of the shelf contact on the slab
{
  const model = boxes([[-20, 5, -20], [20, 9, 20]], [[-5, 20, -5], [5, 24, 5]]);
  const settings = { ...defaultSupportSettings, roofSeededModes: [], lowPolyMode: true };
  const ray = lineTarget(model, settings as never);
  console.log('JOBRUNNER', JSON.stringify(columnLanding({ id: 'auto-shelf', position: [0, 20, 0], normal: [0, -1, 0] }, settings as never, ray).hit));
}
void readFileSync;
