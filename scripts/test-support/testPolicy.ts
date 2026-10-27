import type { PolicyHandle } from '../../src/core/analysis/dentalEngine';
import type { MakePolicy } from '../../src/supports/generateSupports';
import type { Vector } from '../../src/core/vec3';
import { nodeEngine } from './rustImport';

interface TestPolicyHandle extends PolicyHandle {
  set_structures(flags: Uint8Array): void;
  set_permitted_faces(mask: Uint8Array): void;
  set_candidates(ids: string[], values: Float64Array): void;
}
type Ctor = new (repairBudget: number, automatic: number, landingRule: number, islandsOutside: boolean) => TestPolicyHandle;

export interface TestPolicy {
  repairBudget: number;
  automatic: 'as-given' | 'match-candidates';
  structures: { pillar: boolean; tree: boolean; brace: boolean; roof: boolean; cage: boolean; raft: boolean };
  /** Secondary landings only on these faces (1 = permitted); it also gives the policy an outside for islands. */
  landing?: Uint8Array;
  candidates: readonly { id: string; position: Vector; normal: Vector; face?: number }[];
}

/**
 * A policy assembled from data, for synthetic engine tests and their recorded goldens only: the
 * Node test package's `PolicyHandle` constructor (`test-abi`). Production policies are made by Rust
 * `dental_policy` / `generic_policy`; the browser build has no way to assemble one.
 */
export function testPolicy(policy: TestPolicy): MakePolicy {
  return () => {
    const handle = new ((nodeEngine as unknown as { PolicyHandle: Ctor }).PolicyHandle)(policy.repairBudget,
      policy.automatic === 'match-candidates' ? 1 : 0, policy.landing ? 1 : 0, Boolean(policy.landing));
    const s = policy.structures;
    handle.set_structures(Uint8Array.of(...[s.pillar, s.tree, s.brace, s.roof, s.cage, s.raft].map(Number)));
    if (policy.landing) handle.set_permitted_faces(policy.landing);
    const rows = new Float64Array(policy.candidates.length * 7);
    policy.candidates.forEach((c, k) => rows.set([...c.position, ...c.normal, c.face ?? -1], k * 7));
    handle.set_candidates(policy.candidates.map((c) => c.id), rows);
    return handle;
  };
}
