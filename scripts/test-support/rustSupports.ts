import type { ProgressCallback, TriangleMesh } from '../../src/core/analysis/types';
import type { GeneratedSupportMesh, SupportContact, SupportPart } from '../../src/core/supports/mesh';
import type { LiveSupportSettings } from '../../src/core/supports/settings';
import type { ZoneStamp } from '../../src/core/supports/zones';
import type { ColumnInput } from '../../src/supports/supportBuildWasm';
import { withSession } from '../../src/supports/supportEngine';
import { buildSupportsWasm } from './supportBuildCall';

/*
 * The low-level Rust `build_supports` call: every solid (tips, necks, pillars, feet, Auto Trees,
 * Braces, raft, label, Roof, Cage) from contacts, with the neck normals, landings, Auto Tree layout
 * and no-support zones computed in Rust. TESTS ONLY (golden and parity cases in
 * `src/supports/rustSupports.test.ts`): production builds go through `generateSupports` (the
 * `generate` call: policy, safety check, bounded repair, verdicts) and the browser engine has no
 * `build_supports`. A landing rule here is a per-face mask, never a callback.
 */

export interface SupportBuildOptions {
  /** Export always produces full geometry regardless of preview and low-poly settings. */
  mode?: 'preview' | 'export';
  /** The model in the same plate space; supports land on it and the raft follows its outline. */
  model?: TriangleMesh;
  /** Label text embossed on the raft when labels are enabled. */
  labelText?: string;
  onProgress?: ProgressCallback;
  /** No-support zones in plate space. */
  zones?: readonly ZoneStamp[];
  /** Where a support may land: one 0/1 per source face of `model`; an automatic support landing elsewhere is left out. */
  landingFaces?: Uint8Array;
}

const emptyMesh = (): GeneratedSupportMesh => ({ positions: new Float32Array(), indices: new Uint32Array(), parts: [], components: [], dropped: [], droppedByZones: [] });

export function buildSupportMesh(contacts: readonly SupportContact[], settings: Readonly<LiveSupportSettings>, options: SupportBuildOptions = {}): GeneratedSupportMesh {
  if (contacts.length === 0) return emptyMesh();
  const progress = options.onProgress;
  const mode = options.mode === 'export' ? 'export' : 'preview';
  const { model } = options;
  return withSession((session) => {
    const handle = model ? session.load_mesh(Float32Array.from(model.positions), Uint32Array.from(model.indices)) : undefined;
    progress?.(0.05, 'Sampling surface normals');
    const inputs = contacts.map((contact): ColumnInput => ({
      id: contact.id,
      position: contact.position,
      normal: contact.normal,
      origin: contact.origin === 'manual' ? 'manual' : 'auto',
      ...(contact.kind ? { kind: contact.kind } : {}),
      ...(contact.sourceFace === undefined ? {} : { sourceFace: contact.sourceFace }),
      ...(contact.shape ? { shape: contact.shape } : {}),
    }));
    progress?.(0.3, 'Building columns');
    const built = buildSupportsWasm(session, inputs, settings, mode, {
      ...(handle === undefined ? {} : { model: handle }),
      landings: handle === undefined ? 'model' : 'target',
      labelText: options.labelText ?? '',
      ...(options.zones ? { zones: options.zones } : {}),
      ...(options.landingFaces ? { landingFaces: options.landingFaces } : {}),
    });
    const parts: SupportPart[] = [];
    const components = built.components.map(({ origin: _origin, ...component }) => {
      if (!parts.includes(component.part)) parts.push(component.part);
      return component;
    });
    const ids = (indices: readonly number[]) => indices.map((index) => contacts[index]!.id);
    return { positions: built.positions, indices: built.indices, parts, components, dropped: ids(built.dropped), droppedByZones: ids(built.droppedByZones) };
  });
}
