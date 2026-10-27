import { readFileSync } from 'node:fs';
import { nodeEngine, parseStl } from './rustImport';
import type { TriangleMesh } from '../../src/core/analysis/types';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import { jobContacts } from '../../src/supports/genericPolicy';
import { dentalBuildSettings } from '../../src/core/supports/dentalSettings';
import { autoTreeLayout } from './ts-oracle/support-builder/autotree';
import { columnLanding, lineTarget, neckDirection, treeLanding, type Landing } from './ts-oracle/support-builder/landing';
import { buildSupportMesh, type GeneratedSupportMesh, type SupportContact } from './ts-oracle/support-builder/mesh';
import { RemeshTarget } from './ts-oracle/remesh/remesh';
import { defaultSupportSettings, withShape, type LiveSupportSettings } from '../../src/core/supports/settings';
import { GOLDEN_FIXTURES } from '../../src/goldens/fixtures';
import { supportedUnit } from '../../src/goldens/pipeline';
import { applyTransform, transformDirection, transformPoint } from '../../src/state/transform';
import { supportJobOf, resolveSettings } from '../../src/supports/unitSupports';
import { buildSupportsWasm, castDownWasm, type ColumnInput, type WasmSupportBuild } from '../../src/supports/supportBuildWasm';
import { add, normalizeOrDown, scale, type Vector } from '../../src/core/vec3';

/*
 * Parity harness for the Rust support builder (U4a-U4c). The TS builder it compares against is the
 * oracle (scripts/test-support/ts-oracle/support-builder). A scenario is the SAME
 * placement fed to the TS builder and to Rust: plate-space contacts, the model, settings, mode.
 * TS runs the oracle (its own voxel remesh and ray casts); Rust gets the contacts as the placement made them
 * (unsampled normals, the point class) and samples, lands and lays out the Auto Trees itself.
 * Rule 7 (docs/SHIP-PLAN.md): indices, component ids and tags identical; positions within 1e-5 mm.
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

/** The TS reference build (the oracle) for a scenario. */
export function tsBuild(scenario: Scenario, remesh = remeshOf(scenario)): GeneratedSupportMesh {
  return buildSupportMesh(scenario.contacts, scenario.settings, { mode: scenario.mode, model: scenario.model, ...(scenario.labelText ? { labelText: scenario.labelText } : {}), ...(remesh ? { remesh } : {}) });
}

export function remeshOf(scenario: Scenario): RemeshTarget | undefined {
  return exactOnly(scenario) ? undefined : new RemeshTarget(scenario.model, scenario.settings.pillarDiameter);
}

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

/** Every column landing ray of a scenario: TS exact ray cast against the Rust one. Empty `differences` when they agree. */
export function landingDifferences(scenario: Scenario, inputs: readonly ColumnInput[]): { differences: string[]; casts: number; hits: number } {
  const settings = scenario.settings;
  const exact = lineTarget(scenario.model, { ...settings, lowPolyMode: true }, undefined, false);
  const sources: Vector[] = inputs.map((contact, k) => {
    const own = withShape(settings, scenario.contacts[k]!.shape);
    return add(contact.position, scale(neckDirection(normalizeOrDown(contact.normal), own.maxNeckAngle), own.neckLength));
  });
  const rust = withRustModel(scenario, (session, model) => castDownWasm(session, model, sources, exact.height));
  const out: string[] = [];
  sources.forEach((from, k) => {
    const ts = exact.cast(from, exact.height);
    const r = rust[k];
    if (!ts || !r) {
      if (ts || r) out.push(`landing ${k}: ${ts ? 'only TS' : 'only Rust'} hits`);
      return;
    }
    const gap = Math.max(Math.abs(ts.point[1] - r.y), ...ts.normal.map((v, i) => Math.abs(v - r.normal[i]!)));
    if (ts.faceIndex !== r.faceIndex) out.push(`landing ${k}: face ${ts.faceIndex} vs ${r.faceIndex}`);
    else if (gap > 1e-9) out.push(`landing ${k}: differs by ${gap}`);
  });
  return { differences: out, casts: sources.length, hits: rust.filter(Boolean).length };
}

function tagsEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => tagsEqual(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => (a as Record<string, unknown>)[k] !== undefined || (b as Record<string, unknown>)[k] !== undefined));
    return [...keys].every((k) => tagsEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** Differences between the TS build and the Rust build under rule 7; empty when they agree. */
export function compareBuilds(ts: GeneratedSupportMesh, rust: WasmSupportBuild, inputs: readonly ColumnInput[], tolerance = 1e-5): string[] {
  const out: string[] = [];
  if (ts.indices.length !== rust.indices.length) out.push(`index count ${ts.indices.length} vs ${rust.indices.length}`);
  else if (ts.indices.some((v, i) => v !== rust.indices[i])) out.push(`indices differ at ${ts.indices.findIndex((v, i) => v !== rust.indices[i])}`);
  if (ts.positions.length !== rust.positions.length) out.push(`position count ${ts.positions.length} vs ${rust.positions.length}`);
  else {
    let worst = 0;
    for (let i = 0; i < ts.positions.length; i += 1) worst = Math.max(worst, Math.abs(ts.positions[i]! - rust.positions[i]!));
    if (worst > tolerance) out.push(`max position difference ${worst} mm`);
  }
  const strip = (c: { origin?: unknown }) => ({ ...c, origin: undefined });
  // Tags: ids, parts, ranges and face ids identical; intent points and normals within 1e-9 (JS Math.hypot and Rust sqrt differ in the last bit).
  const tsTags = ts.components.map((c) => JSON.parse(JSON.stringify(c)));
  const rustTags = rust.components.map((c) => JSON.parse(JSON.stringify(strip(c))));
  const at = tsTags.findIndex((c, i) => !tagsEqual(c, rustTags[i]));
  if (tsTags.length !== rustTags.length || at >= 0) {
    out.push(`component tags differ (${tsTags.length} vs ${rustTags.length}) at ${at}: ${JSON.stringify(tsTags[at])} vs ${JSON.stringify(rustTags[at])}`);
  }
  const originOf = new Map(inputs.map((c) => [c.id, c.origin]));
  for (const c of rust.components) {
    const want = c.contactId === undefined ? undefined : originOf.get(c.contactId);
    if (c.origin !== want) out.push(`origin tag of ${c.part} ${c.contactId}: ${c.origin} vs ${want}`);
  }
  if (JSON.stringify(ts.dropped) !== JSON.stringify(rust.dropped.map((i) => inputs[i]!.id))) out.push('dropped differs');
  return out;
}

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
  const region = proposeDentalSupportRegion(mesh);
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
    settings: withStructures(dentalBuildSettings({ ...defaultSupportSettings, lowPolyMode: lowPoly })),
    mode,
    labelText: 'A',
  };
}
