import type { ProgressCallback, TriangleMesh } from '../core/analysis/types';
import type { GeneratedSupportMesh, SupportContact, SupportIssue, SupportPart, SupportVerdict } from '../core/supports/mesh';
import type { LiveSupportSettings } from '../core/supports/settings';
import type { ZoneStamp } from '../core/supports/zones';
import type { Vector } from '../core/vec3';
import { decodeComponents, packContacts, packSettings, packZones, type ColumnInput } from './supportBuildWasm';
import { supportEngine, withSession, type PolicyDataHandle } from './supportEngine';

/*
 * Host adapter of the Rust `generate` (U7): one call runs permit, build, the exact body check, the
 * bounded repair and the verdicts for either policy. A policy crosses as data (`PolicyInput`, what
 * `PolicyResult` holds); there is no callback and no retry loop here. Contacts and the model are in
 * plate space.
 */

export interface PolicyCandidate {
  id: string;
  position: Vector;
  normal: Vector;
  /** Exact source face of the contact, when the policy knows it. */
  face?: number;
}

export interface AreaStampInput {
  center: Vector;
  radius: number;
  normal: Vector;
  allow: boolean;
}

export interface PolicyInput {
  /** Maximum repair rebuilds; 0 reports without repairing. */
  repairBudget: number;
  /** `match-candidates`: an automatic contact is built only if it reproduces a candidate. */
  automatic: 'as-given' | 'match-candidates';
  structures: { pillar: boolean; tree: boolean; brace: boolean; roof: boolean; cage: boolean; raft: boolean };
  /** Secondary landings only on these source faces (1 = permitted), after the edits; absent: anywhere. */
  landing?: { permittedFaces: Uint8Array; stamps: readonly AreaStampInput[] };
  candidates: readonly PolicyCandidate[];
  /** Repair options in trial order for the candidate `owner`. */
  alternates: readonly { owner: string; candidate: PolicyCandidate }[];
  rings: readonly { perimeterMm: number; spacingMm: number; arcs: readonly { id: string; arcMm: number }[] }[];
}

/** The generic policy: contacts as given, anything allowed, report only. */
export const genericPolicyInput: PolicyInput = {
  repairBudget: 0, automatic: 'as-given', candidates: [], alternates: [], rings: [],
  structures: { pillar: true, tree: true, brace: true, roof: true, cage: true, raft: true },
};

export interface RingMeasure {
  perimeterMm: number;
  retained: number;
  maxGapMm: number;
  reviewGapMm: number;
  needsReview: boolean;
}

export interface GenerateOptions {
  mode?: 'preview' | 'export';
  /** The model in plate space. */
  model: TriangleMesh;
  labelText?: string;
  zones?: readonly ZoneStamp[];
  /** Ends the repair and the checks early with an inconclusive verdict. */
  timeoutMs?: number;
  /** The request's revision: the engine echoes it so the host can drop a result that is not the newest. */
  revision?: number;
  onProgress?: ProgressCallback;
}

export interface GenerateOutput {
  mesh: GeneratedSupportMesh;
  rings: RingMeasure[];
  fallback: Array<'tree' | 'brace'>;
  trials: number;
  revision: number;
}

interface Generation {
  take_positions(): Float32Array; take_indices(): Uint32Array; take_tags(): Uint32Array;
  take_reach(): Float64Array; take_intents(): Float64Array; take_contact_ids(): string[];
  take_dropped(): string[]; take_dropped_by_zones(): string[]; take_fallback(): Uint8Array;
  status(): number; reason(): string; take_issues(): Uint32Array;
  take_island_heights(): Float64Array; take_island_vertices(): Uint32Array; take_island_status(): Uint8Array; island_reason(): string;
  take_rings(): Float64Array; trials(): number; revision(): number; free(): void;
}

interface GenerateSession {
  load_mesh(positions: Float32Array, indices: Uint32Array): number;
  generate(model: number, ids: string[], contacts: Float64Array, shapes: Float64Array, settings: Float64Array, mode: number,
    labelText: string, zones: Float64Array, policy: PolicyDataHandle, timeoutMs: number, revision: number): Generation;
}

const PARTS: readonly SupportPart[] = [
  'tip', 'neck', 'pillar', 'foot', 'brace', 'raft', 'tree-branch', 'tree-trunk', 'roof', 'column', 'roof-brace', 'cross-bar', 'cage-ring', 'label',
];
const STATUS = ['clear', 'blocked', 'inconclusive'] as const;
const NO_CONTACT = 0xffffffff;
const ISSUE_STRIDE = 5;
const ISSUE_ORIGIN = ['auto', 'manual', 'structural'] as const;
const ISLAND_STATUS = ['resolved', 'unresolved', 'manual-only'] as const;

function candidateRows(list: readonly PolicyCandidate[]): Float64Array {
  const rows = new Float64Array(list.length * 7);
  list.forEach((c, k) => rows.set([...c.position, ...c.normal, c.face ?? -1], k * 7));
  return rows;
}

/** Fills the engine's `PolicyData` from a policy; the caller frees it. */
function policyData(policy: PolicyInput): PolicyDataHandle {
  const data = new (supportEngine().PolicyData)(policy.repairBudget, policy.automatic === 'match-candidates' ? 1 : 0, policy.landing ? 1 : 0);
  try {
    const s = policy.structures;
    data.set_structures(Uint8Array.of(...[s.pillar, s.tree, s.brace, s.roof, s.cage, s.raft].map(Number)));
    if (policy.landing) {
      data.set_permitted_faces(policy.landing.permittedFaces);
      const stamps = new Float64Array(policy.landing.stamps.length * 8);
      policy.landing.stamps.forEach((st, k) => stamps.set([...st.center, st.radius, ...st.normal, st.allow ? 1 : 0], k * 8));
      data.set_stamps(stamps);
    }
    data.set_candidates(policy.candidates.map((c) => c.id), candidateRows(policy.candidates));
    data.set_alternates(policy.alternates.map((a) => a.owner), policy.alternates.map((a) => a.candidate.id), candidateRows(policy.alternates.map((a) => a.candidate)));
    for (const ring of policy.rings) data.add_ring(ring.perimeterMm, ring.spacingMm, ring.arcs.map((a) => a.id), Float64Array.from(ring.arcs, (a) => a.arcMm));
    return data;
  } catch (error) {
    data.free();
    throw error;
  }
}

export function generateSupports(contacts: readonly SupportContact[], settings: Readonly<LiveSupportSettings>, policy: PolicyInput, options: GenerateOptions): GenerateOutput {
  const empty = (): GenerateOutput => ({
    mesh: { positions: new Float32Array(), indices: new Uint32Array(), parts: [], components: [], dropped: [], droppedByZones: [],
      verdict: { status: 'clear', issues: [] }, islands: { status: 'ok', islands: [] } },
    rings: [], fallback: [], trials: 0, revision: options.revision ?? 0,
  });
  if (contacts.length === 0) return empty();
  const { model } = options;
  options.onProgress?.(0.05, 'Sampling surface normals');
  return withSession((session) => {
    const wasm = session as unknown as GenerateSession;
    const handle = wasm.load_mesh(Float32Array.from(model.positions), Uint32Array.from(model.indices));
    const inputs = contacts.map((contact): ColumnInput => ({
      id: contact.id,
      position: contact.position,
      normal: contact.normal,
      origin: contact.origin === 'manual' ? 'manual' : 'auto',
      ...(contact.kind ? { kind: contact.kind } : {}),
      ...(contact.shape ? { shape: contact.shape } : {}),
    }));
    const packed = packContacts(inputs);
    const data = policyData(policy);
    let result: Generation;
    try {
      result = wasm.generate(handle, inputs.map((c) => c.id), packed.contacts, packed.shapes, packSettings(settings), options.mode === 'export' ? 1 : 0,
        options.labelText ?? '', packZones(options.zones ?? []), data, options.timeoutMs ?? 0, options.revision ?? 0);
    } finally {
      data.free();
    }
    try {
      const ids = result.take_contact_ids();
      const components = decodeComponents(result.take_tags(), result.take_reach(), result.take_intents(), (k) => ids[k]!);
      const parts: SupportPart[] = [];
      for (const component of components) if (!parts.includes(component.part)) parts.push(component.part);
      const issues = result.take_issues();
      const found: SupportIssue[] = [];
      for (let k = 0; k < issues.length; k += ISSUE_STRIDE) {
        found.push({
          ...(issues[k] === NO_CONTACT ? {} : { contactId: ids[issues[k]!]! }),
          part: PARTS[issues[k + 1]!]!, modelFace: issues[k + 2]!, blocked: issues[k + 3] === 1, origin: ISSUE_ORIGIN[issues[k + 4]!]!,
        });
      }
      const reason = result.reason();
      const verdict: SupportVerdict = { status: STATUS[result.status()]!, ...(reason ? { reason } : {}), issues: found };
      const islandReason = result.island_reason();
      const heights = result.take_island_heights();
      const vertices = result.take_island_vertices();
      const status = result.take_island_status();
      const islands = islandReason
        ? { status: 'inconclusive' as const, reason: islandReason }
        : { status: 'ok' as const, islands: Array.from(heights, (height, k) => ({ height, vertex: vertices[k]!, status: ISLAND_STATUS[status[k]!]! })) };
      const rows = result.take_rings();
      const rings: RingMeasure[] = [];
      for (let k = 0; k < rows.length; k += 5) {
        rings.push({ perimeterMm: rows[k]!, retained: rows[k + 1]!, maxGapMm: rows[k + 2]!, reviewGapMm: rows[k + 3]!, needsReview: rows[k + 4] === 1 });
      }
      const revision = result.revision();
      const mesh: GeneratedSupportMesh = {
        revision,
        positions: result.take_positions(), indices: result.take_indices(), parts, components,
        dropped: result.take_dropped(), droppedByZones: result.take_dropped_by_zones(), verdict, islands,
      };
      return { mesh, rings, fallback: Array.from(result.take_fallback(), (f) => (f === 1 ? 'tree' as const : 'brace' as const)), trials: result.trials(), revision };
    } finally {
      result.free();
    }
  });
}
