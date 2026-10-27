import { readFileSync } from 'node:fs';
import { nodeEngine, parseStl } from '../../scripts/test-support/rustImport';
import type { TriangleMesh } from '../core/analysis/types';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import { jobContacts } from '../core/jobs';
import { columnLanding, lineTarget, type Landing } from '../core/supports/landing';
import { buildSupportMesh, type GeneratedSupportMesh, type SupportContact } from '../core/supports/mesh';
import { RemeshTarget } from '../core/supports/remesh';
import { defaultSupportSettings, withShape, type LiveSupportSettings } from '../core/supports/settings';
import { GOLDEN_FIXTURES } from '../goldens/fixtures';
import { supportedUnit } from '../goldens/pipeline';
import { applyTransform, transformDirection, transformPoint } from '../state/transform';
import { supportJobOf, resolveSettings } from '../supports/unitSupports';
import { buildSupportsWasm, type ColumnInput, type WasmSupportBuild } from './supportBuildWasm';

/*
 * Parity harness for the Rust support builder (U4a; reused by U4b/U4c). A scenario is the SAME
 * placement fed to the TS builder and to Rust: plate-space contacts, the model, settings, mode.
 * TS runs with its own ray cast; Rust gets what that ray cast produced (sampled normals, the
 * landing under each neck), because placement and ray casting are not part of the builder port.
 * Rule 7 (docs/SHIP-PLAN.md): indices, component ids and tags identical; positions within 1e-5 mm.
 */

export interface Scenario {
  name: string;
  model: TriangleMesh;
  contacts: SupportContact[];
  settings: LiveSupportSettings;
  mode: 'preview' | 'export';
}

/** Settings with the structures a unit of the port has not reached switched off. U4b removes Tree/Brace from this list. */
export function withoutStructures(settings: LiveSupportSettings, keep: { tree?: boolean; brace?: boolean } = {}): LiveSupportSettings {
  return { ...settings, scatterAutoTree: keep.tree ?? false, trussEnabled: keep.brace ?? false, raftEnabled: false, roofMode: 'OFF', roofSeededModes: [] };
}

const exactOnly = (s: Scenario) => s.settings.lowPolyMode && s.mode === 'preview';

/** The TS reference build (the oracle) for a scenario. */
export function tsBuild(scenario: Scenario, remesh = remeshOf(scenario)): GeneratedSupportMesh {
  return buildSupportMesh(scenario.contacts, scenario.settings, { mode: scenario.mode, model: scenario.model, ...(remesh ? { remesh } : {}) });
}

export function remeshOf(scenario: Scenario): RemeshTarget | undefined {
  return exactOnly(scenario) ? undefined : new RemeshTarget(scenario.model, scenario.settings.pillarDiameter);
}

/** What the TS builder's own ray cast gives each contact: the sampled normal and the column landing under its neck. */
export function rustInputs(scenario: Scenario, remesh = remeshOf(scenario)): ColumnInput[] {
  const ray = lineTarget(scenario.model, scenario.settings, remesh, scenario.mode === 'export');
  const tipOnly = scenario.mode === 'preview' && scenario.settings.previewMode === 'ONLY_TIP';
  return scenario.contacts.map((contact): ColumnInput => {
    const sampled = { ...contact, normal: ray.normal(contact) };
    const landing: Landing | undefined = tipOnly ? undefined : columnLanding(sampled, withShape(scenario.settings, contact.shape), ray).hit;
    return {
      id: contact.id,
      position: sampled.position,
      normal: sampled.normal,
      origin: contact.origin === 'manual' ? 'manual' : 'auto',
      ...(contact.sourceFace === undefined ? {} : { sourceFace: contact.sourceFace }),
      ...(contact.shape ? { shape: contact.shape } : {}),
      ...(landing ? { landing: { point: landing.point, normal: landing.normal, ...(landing.faceIndex === undefined ? {} : { faceIndex: landing.faceIndex }) } } : {}),
    };
  });
}

export function rustBuild(scenario: Scenario, inputs = rustInputs(scenario)): WasmSupportBuild {
  return buildSupportsWasm(nodeEngine, inputs, scenario.settings, scenario.mode);
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
  const tsTags = ts.components.map((c) => JSON.parse(JSON.stringify(c)));
  const rustTags = rust.components.map((c) => JSON.parse(JSON.stringify(strip(c))));
  if (JSON.stringify(tsTags) !== JSON.stringify(rustTags)) {
    const at = tsTags.findIndex((c, i) => JSON.stringify(c) !== JSON.stringify(rustTags[i]));
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
        settings: withoutStructures(resolveSettings(unit.settings)),
        mode,
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
    settings: withoutStructures({ ...defaultSupportSettings, roofSeededModes: [], lowPolyMode: lowPoly }),
    mode,
  };
}
