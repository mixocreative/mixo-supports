import { readFileSync } from 'node:fs';
import { nodeEngine, parseStl } from './rustImport';
import type { TriangleMesh } from '../../src/core/analysis/types';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import { jobContacts } from '../../src/supports/genericPolicy';
import { REFERENCE_PROFILE, referenceTuning } from './referenceProfile';
import type { SupportContact } from '../../src/core/supports/mesh';
import { defaultSupportSettings, setRoofMode, updateSetting, withShape, type LiveSupportSettings } from '../../src/core/supports/settings';
import { approxArray, exactArray } from './golden';
import { buildSnapshot } from './buildSnapshot';
import { GOLDEN_FIXTURES } from '../../src/goldens/fixtures';
import { supportedUnit } from '../../src/goldens/pipeline';
import { applyTransform, transformDirection, transformPoint } from '../../src/state/transform';
import { supportJobOf, resolveSettings } from '../../src/supports/unitSupports';
import type { ColumnInput } from '../../src/supports/supportBuildWasm';
import { buildSupportsWasm, castDownWasm, type WasmSupportBuild } from './supportBuildCall';
import { add, normalizeOrDown, scale, type Vector } from '../../src/core/vec3';

/*
 * Parity harness for the Rust support builder (U4a-U4c, U9). A scenario is a placement: plate-space contacts,
 * the model, settings, mode. Rust gets the contacts as the placement made them (unsampled normals, the point
 * class) and samples, lands and lays out the Auto Trees itself; its build is compared with the result the
 * TS builder (the former oracle) produced, recorded in scripts/fixtures/golden/builder/ (see
 * scripts/test-support/golden.ts for regeneration). Rule 7 (docs/SHIP-PLAN.md): indices, component ids and
 * tags identical; positions within 1e-5 mm.
 */

export interface Scenario {
  name: string;
  model: TriangleMesh;
  contacts: SupportContact[];
  settings: LiveSupportSettings;
  mode: 'preview' | 'export';
  /** Label embossed on the raft (needs raft + labels on); none by default. */
  labelText?: string;
}

/** Settings with Tree and Brace as configured unless `force` sets them; Raft, Roof, Cage and the label stay as configured. */
export function withStructures(settings: LiveSupportSettings, force: { tree?: boolean; brace?: boolean } = {}): LiveSupportSettings {
  return { ...settings, scatterAutoTree: force.tree ?? settings.scatterAutoTree, trussEnabled: force.brace ?? settings.trussEnabled, roofSeededModes: [] };
}

const exactOnly = (s: Scenario) => s.settings.lowPolyMode && s.mode === 'preview';

/** The contacts as the placement made them: Rust samples the neck normals and casts the landings itself. */
export function rustInputs(scenario: Scenario): ColumnInput[] {
  return scenario.contacts.map((contact): ColumnInput => ({
    id: contact.id,
    position: contact.position,
    normal: contact.normal,
    origin: contact.origin === 'manual' ? 'manual' : 'auto',
    ...(contact.kind ? { kind: contact.kind } : {}),
    ...(contact.sourceFace === undefined ? {} : { sourceFace: contact.sourceFace }),
    ...(contact.shape ? { shape: contact.shape } : {}),
  }));
}

type Session = { load_mesh(positions: Float32Array, indices: Uint32Array): number; free(): void };

/** Runs `use` with the scenario's model loaded in a fresh Rust session. */
export function withRustModel<T>(scenario: Scenario, use: (session: Session, model: number) => T): T {
  const session = new (nodeEngine as unknown as { GeometrySession: new (bytes: number) => Session }).GeometrySession(0x30000000);
  try {
    return use(session, session.load_mesh(Float32Array.from(scenario.model.positions), Uint32Array.from(scenario.model.indices)));
  } finally {
    session.free();
  }
}

/** The Rust build: neck normals, landings (voxel remesh unless a Low Poly preview) and the Auto Tree layout are its own. */
export function rustBuild(scenario: Scenario, inputs = rustInputs(scenario)): WasmSupportBuild {
  const label = scenario.labelText ? { labelText: scenario.labelText } : {};
  return withRustModel(scenario, (session, model) => buildSupportsWasm(session, inputs, scenario.settings, scenario.mode, { model, landings: 'target', ...label }));
}

export const landsOnExactSurface = exactOnly;

/** The neck follows the surface normal but tilts at most `maxAngle` degrees from straight down. */
function neckDirection(normal: Vector, maxAngle: number): Vector {
  const angle = Math.acos(Math.max(-1, Math.min(1, -normal[1])));
  const limit = maxAngle * Math.PI / 180;
  if (angle <= limit) return normal;
  const horizontal = Math.hypot(normal[0], normal[2]);
  if (horizontal < 1e-9) return [0, -1, 0];
  const sin = Math.sin(limit);
  return [normal[0] / horizontal * sin, -Math.cos(limit), normal[2] / horizontal * sin];
}

/** The start of every column's landing ray (the neck's lower end) and the cast length (model height). */
export function landingSources(scenario: Scenario, inputs: readonly ColumnInput[]): { sources: Vector[]; height: number } {
  const settings = scenario.settings;
  let low = Infinity;
  let high = -Infinity;
  for (let at = 1; at < scenario.model.positions.length; at += 3) {
    low = Math.min(low, scenario.model.positions[at]!);
    high = Math.max(high, scenario.model.positions[at]!);
  }
  const sources = inputs.map((contact, k): Vector => {
    const own = withShape(settings, scenario.contacts[k]!.shape);
    return add(contact.position, scale(neckDirection(normalizeOrDown(contact.normal), own.maxNeckAngle), own.neckLength));
  });
  return { sources, height: high - low };
}

export interface LandingHit { faceIndex: number; y: number; normal: Vector }

/** Comparable record of the landing rays: hit faces exact, heights and normals within tolerance. */
export function landingSnapshot(hits: readonly (LandingHit | undefined)[]) {
  return {
    faces: exactArray(hits.map((hit) => hit?.faceIndex ?? -1)),
    values: approxArray(hits.flatMap((hit) => (hit ? [hit.y, ...hit.normal] : [0, 0, 0, 0])), 1),
  };
}

/** The Rust exact-surface landing rays of a scenario (one entry per contact, undefined when the ray hits nothing). */
export function rustLandingHits(scenario: Scenario, inputs: readonly ColumnInput[]): (LandingHit | undefined)[] {
  const { sources, height } = landingSources(scenario, inputs);
  return withRustModel(scenario, (session, model) => castDownWasm(session, model, sources, height));
}

/** The comparable snapshot of a Rust build (the recorder builds the same shape from the TS build). */
export function rustSnapshot(build: WasmSupportBuild, inputs: readonly ColumnInput[]) {
  return buildSnapshot({ positions: build.positions, indices: build.indices, components: build.components, dropped: build.dropped.map((i) => inputs[i]!.id) });
}

/** Origin tags of the Rust components against the inputs; empty when they agree. */
export function originMismatches(rust: WasmSupportBuild, inputs: readonly ColumnInput[]): string[] {
  const originOf = new Map(inputs.map((c) => [c.id, c.origin]));
  const out: string[] = [];
  for (const c of rust.components) {
    const want = c.contactId === undefined ? undefined : originOf.get(c.contactId);
    if (c.origin !== want) out.push(`origin tag of ${c.part} ${c.contactId}: ${c.origin} vs ${want}`);
  }
  return out;
}

/** Golden file of a scenario or case: `builder/<name>` with the characters a file name dislikes replaced. */
export const goldenName = (scenarioName: string, folder = 'builder'): string => `${folder}/${scenarioName.replace(/[^A-Za-z0-9.-]+/g, '_')}`;

/** Contacts of a golden fixture variant as the app builds them, in plate space. */
export function fixtureScenarios(mode: 'preview' | 'export'): Scenario[] {
  const out: Scenario[] = [];
  for (const fixture of GOLDEN_FIXTURES) {
    for (const variant of fixture.variants) {
      const unit = supportedUnit(fixture, variant);
      const job = supportJobOf(unit, 0, mode);
      const frame = job.frame!;
      out.push({
        name: `${fixture.name}.${variant}.${mode}`,
        model: applyTransform(job.mesh, frame),
        contacts: jobContacts(job.contacts).map((c): SupportContact => ({
          id: c.id, position: transformPoint(frame, c.position), normal: transformDirection(frame, c.normal),
          ...(c.kind ? { kind: c.kind } : {}), ...(c.origin === 'manual' ? { origin: 'manual' as const } : {}), ...(c.shape ? { shape: c.shape } : {}),
        })),
        settings: withStructures(resolveSettings(unit.settings)),
        mode,
        labelText: 'A',
      });
    }
  }
  return out;
}

/** The reference aligner with the dental region's own contact candidates (exact source faces), lifted to the default lift height. */
export function alignerScenario(mode: 'preview' | 'export', lowPoly: boolean): Scenario | undefined {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  const mesh = parseStl(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'aligner');
  const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
  if (region.kind !== 'proposal' || !region.contacts) return undefined;
  let low = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) low = Math.min(low, mesh.positions[i]!);
  const lift = defaultSupportSettings.liftHeight - low;
  const positions = Float32Array.from(mesh.positions, (v, i) => (i % 3 === 1 ? v + lift : v));
  return {
    name: `aligner.${mode}${lowPoly ? '.low-poly' : ''}`,
    model: { positions, indices: mesh.indices },
    contacts: region.contacts.map((c, i): SupportContact => ({
      id: `dental-${i}`, position: [c.position[0], c.position[1] + lift, c.position[2]], normal: [...c.normal], sourceFace: c.face,
    })),
    // What a dental build uses with the default switches: Tree and Brace on, Roof and Cage off.
    settings: withStructures({ ...defaultSupportSettings, lowPolyMode: lowPoly, scatterAutoTree: true, trussEnabled: true, roofMode: 'OFF', roofSeededModes: [] }),
    mode,
    labelText: 'A',
  };
}

/** Settings and per-support shapes that reach other column code paths, applied to the export scenarios of two fixtures. */
export const PARITY_VARIANTS: [string, (s: LiveSupportSettings) => LiveSupportSettings][] = [
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

export function variantScenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const scenario of fixtureScenarios('export').filter((s) => s.name.startsWith('cube-overhang.default') || s.name.startsWith('knot.default'))) {
    for (const [label, change] of PARITY_VARIANTS) {
      out.push({ ...scenario, name: `${scenario.name} ${label}`, settings: change(scenario.settings), ...(label.startsWith('label AB') ? { labelText: 'AB-12' } : {}) });
    }
    out.push({ ...scenario, name: `${scenario.name} tips-only`, mode: 'preview', settings: { ...scenario.settings, previewMode: 'ONLY_TIP' } });
    const contacts = scenario.contacts.map((c, i): SupportContact => i % 3 === 0
      ? { ...c, origin: 'manual', shape: i % 2 === 0 ? { contactShape: 'SPHERE', touchDiameter: 0.9, touchDepth: 0.1 } : { tipSection: 'CROSS', pointDiameter: 0.4, neckLength: 3 } }
      : c);
    out.push({ ...scenario, name: `${scenario.name} manual+shapes`, contacts });
  }
  return out;
}
