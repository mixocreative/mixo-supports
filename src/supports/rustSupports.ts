import type { ProgressCallback, TriangleMesh } from '../core/analysis/types';
import { autoTreeLayout, type AutoTreeLayout } from '../core/supports/autotree';
import { columnLanding, lineTarget, treeLanding, type Lander, type Landing } from '../core/supports/landing';
import type { GeneratedSupportMesh, SupportContact, SupportPart } from '../core/supports/mesh';
import { meshBounds } from '../core/supports/meshQuery';
import type { RemeshTarget } from '../core/supports/remesh';
import { withShape, type LiveSupportSettings } from '../core/supports/settings';
import type { ZoneStamp } from '../core/supports/zones';
import { hostOmissions, hostPolicyActive } from './hostOmissions';
import { buildSupportsWasm, castDownWasm, type ColumnInput, type SuppliedLanding } from './supportBuildWasm';
import { supportEngine } from './supportEngine';
import type { Vector } from '../core/vec3';

/*
 * Production support mesh build (U4c cut-over): every solid (tips, necks, pillars, feet, Auto Trees,
 * Braces, raft, label, Roof, Cage) is built by the Rust `build_supports`; typed arrays go in once and
 * come out once. What still runs in TypeScript until U5 / U7, and is fed to Rust:
 *  - neck normals and landings on the voxel-remeshed surface (export and non-Low-Poly previews;
 *    the remesh is U5), supplied per contact and per tree; Low Poly previews let Rust cast them
 *    against the exact surface;
 *  - the Auto Tree layout when Safe Distance is not 0 (it reads the scatter remesh, U5) or when a
 *    policy below needs it (the same layout Rust would find);
 *  - the no-support zone / landing-rule decisions (`hostOmissions`, U7), applied as omissions.
 */

export interface SupportBuildOptions {
  /** Export always produces full geometry regardless of preview and low-poly settings. */
  mode?: 'preview' | 'export';
  /** The model in the same plate space; supports land on it and the raft follows its outline. */
  model?: TriangleMesh;
  /** Label text embossed on the raft when labels are enabled. */
  labelText?: string;
  /** Cached remesh of `model` for Middle Ø (see `lineTarget`); built on demand otherwise. */
  remesh?: RemeshTarget;
  /** Cached scatter remesh of `model` (voxel Spacing / 4) for Safe Distance; built on demand otherwise. */
  scatterRemesh?: RemeshTarget;
  onProgress?: ProgressCallback;
  /** No-support zones in plate space (see `hostOmissions`). */
  zones?: readonly ZoneStamp[];
  /** Reject an automatic support if its secondary contact would land on a forbidden model face. */
  landingAllowed?: (landing: Landing) => boolean;
}

/** Mesh bytes the one-shot session may hold. */
const SESSION_BYTES = 0x30000000;

const emptyMesh = (): GeneratedSupportMesh => ({ positions: new Float32Array(), indices: new Uint32Array(), parts: [], components: [], dropped: [], droppedByZones: [] });

/** Exact-surface landings from the Rust core (a Low Poly Mode preview lands on the exact model). */
class ExactLander implements Lander {
  readonly height: number;
  constructor(private readonly session: unknown, private readonly model: number, mesh: TriangleMesh) {
    const bounds = meshBounds(mesh);
    this.height = bounds.max[1] - bounds.min[1];
  }

  cast(from: Vector, length: number): Landing | undefined {
    const [hit] = castDownWasm(this.session, this.model, [from], length);
    return hit ? { point: [from[0], hit.y, from[2]], normal: hit.normal, faceIndex: hit.faceIndex } : undefined;
  }

  normal(contact: SupportContact): Vector {
    return contact.kind === 'vertical' ? [0, -1, 0] : contact.normal;
  }
}

export function buildSupportMesh(contacts: readonly SupportContact[], settings: Readonly<LiveSupportSettings>, options: SupportBuildOptions = {}): GeneratedSupportMesh {
  if (contacts.length === 0) return emptyMesh();
  const progress = options.onProgress;
  const exporting = options.mode === 'export';
  const tipOnly = !exporting && settings.previewMode === 'ONLY_TIP';
  const exact = settings.lowPolyMode && !exporting;
  const { model } = options;
  const session = new (supportEngine().GeometrySession)(SESSION_BYTES);
  try {
    const handle = model ? session.load_mesh(Float32Array.from(model.positions), Uint32Array.from(model.indices)) : undefined;
    progress?.(0.05, 'Sampling surface normals');
    const lander: Lander | undefined = !model || handle === undefined ? undefined
      : exact ? new ExactLander(session, handle, model) : lineTarget(model, settings, options.remesh, exporting);
    const sampled = lander ? contacts.map((contact) => ({ ...contact, normal: lander.normal(contact) })) : contacts;
    const supplied = lander !== undefined && !exact;
    const policy = hostPolicyActive(options.zones, options.landingAllowed);

    // The layout is computed here when Rust cannot (Safe Distance reads the scatter remesh, U5), when the
    // policy or the supplied tree landings need it, and otherwise left to Rust.
    // TODO(U5): the scatter remesh and the voxel remesh land in Rust; supplied layout and landings go away.
    let layout: AutoTreeLayout | undefined;
    if (settings.scatterAutoTree && model && (supplied || policy || settings.scatterSafeDistance !== 0)) {
      layout = autoTreeLayout(sampled, model, settings, options.scatterRemesh);
    }
    const hits: (Landing | undefined)[] = [];
    const columnHit = (index: number): Landing | undefined => {
      if (!(index in hits)) hits[index] = columnLanding(sampled[index]!, withShape(settings, sampled[index]!.shape), lander).hit;
      return hits[index];
    };
    const omissions = policy
      ? hostOmissions({ contacts: sampled, settings, tipOnly, layout, columnHit, treeHit: (tree) => treeLanding(tree, settings, lander).hit,
        ...(options.zones ? { zones: options.zones } : {}), ...(options.landingAllowed ? { landingAllowed: options.landingAllowed } : {}) })
      : undefined;

    progress?.(0.3, 'Building columns');
    const inputs = sampled.map((contact, index): ColumnInput => {
      const hit = supplied && !tipOnly ? columnHit(index) : undefined;
      return {
        id: contact.id,
        position: contact.position,
        normal: contact.normal,
        origin: contact.origin === 'manual' ? 'manual' : 'auto',
        ...(contact.sourceFace === undefined ? {} : { sourceFace: contact.sourceFace }),
        ...(contact.shape ? { shape: contact.shape } : {}),
        ...(hit ? { landing: { point: hit.point, normal: hit.normal, ...(hit.faceIndex === undefined ? {} : { faceIndex: hit.faceIndex }) } } : {}),
      };
    });
    const treeLandings: (SuppliedLanding | undefined)[] = supplied && layout
      ? layout.trees.map((tree) => treeLanding(tree, settings, lander).hit) : [];
    const built = buildSupportsWasm(session, inputs, settings, exporting ? 'export' : 'preview', {
      ...(handle === undefined ? {} : { model: handle }),
      landings: supplied ? 'supplied' : 'model',
      treeLandings,
      labelText: options.labelText ?? '',
      ...(layout ? { layout } : {}),
      ...(omissions ? { omitContacts: omissions.contacts, omitTrees: omissions.trees } : {}),
    });
    const parts: SupportPart[] = [];
    const components = built.components.map(({ origin: _origin, ...component }) => {
      if (!parts.includes(component.part)) parts.push(component.part);
      return component;
    });
    const ids = (indices: readonly number[]) => indices.map((index) => contacts[index]!.id);
    return { positions: built.positions, indices: built.indices, parts, components, dropped: ids(built.dropped), droppedByZones: ids(omissions?.byZones ?? []) };
  } finally {
    session.free();
  }
}
