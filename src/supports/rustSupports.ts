import type { ProgressCallback, TriangleMesh } from '../core/analysis/types';
import type { GeneratedSupportMesh, Landing, SupportContact, SupportPart } from '../core/supports/mesh';
import type { LiveSupportSettings } from '../core/supports/settings';
import type { ZoneStamp } from '../core/supports/zones';
import { buildSupportsWasm, probeLandingsWasm, type ColumnInput, type ProbedLanding } from './supportBuildWasm';
import { withSession } from './supportEngine';

/*
 * Production support mesh build: every solid (tips, necks, pillars, feet, Auto Trees, Braces, raft,
 * label, Roof, Cage) is built by the Rust `build_supports`, which also samples the neck normals and
 * casts the landings on the voxel remesh (exact surface in a Low Poly preview), lays out the Auto
 * Trees (Safe Distance included) and applies the no-support zones. Typed arrays go in once and come
 * out once. What the host still decides, until the U7 safety engine: a landing rule (dental: the
 * secondary contact must land on an approved side), evaluated on the landings Rust probes and handed
 * back as flags, and the label text.
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
  /** Reject an automatic support if its secondary contact would land on a forbidden model face. */
  landingAllowed?: (landing: Landing) => boolean;
}

const emptyMesh = (): GeneratedSupportMesh => ({ positions: new Float32Array(), indices: new Uint32Array(), parts: [], components: [], dropped: [], droppedByZones: [] });

const asLanding = (hit: ProbedLanding): Landing => ({ point: hit.point, sourcePoint: hit.point, normal: [0, 1, 0], ...(hit.face === undefined ? {} : { faceIndex: hit.face }) });

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
    let rejectedColumns: boolean[] | undefined;
    let rejectedTrees: boolean[] | undefined;
    if (options.landingAllowed && handle !== undefined) {
      const probe = probeLandingsWasm(session, inputs, settings, mode, handle);
      const rejects = (hit: ProbedLanding | undefined) => hit !== undefined && !options.landingAllowed!(asLanding(hit));
      rejectedColumns = probe.columns.map(rejects);
      rejectedTrees = probe.trees.map(rejects);
    }
    progress?.(0.3, 'Building columns');
    const built = buildSupportsWasm(session, inputs, settings, mode, {
      ...(handle === undefined ? {} : { model: handle }),
      landings: handle === undefined ? 'model' : 'target',
      labelText: options.labelText ?? '',
      ...(options.zones ? { zones: options.zones } : {}),
      ...(rejectedColumns ? { rejectedColumns, rejectedTrees: rejectedTrees! } : {}),
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
