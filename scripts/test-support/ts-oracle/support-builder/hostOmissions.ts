import type { AutoTree, AutoTreeLayout } from '../core/supports/autotree';
import type { Landing } from '../core/supports/landing';
import type { SupportContact } from '../core/supports/mesh';
import { tipDepth, withShape, type LiveSupportSettings } from '../core/supports/settings';
import { zonedAt, type ZoneStamp } from '../core/supports/zones';
import { normalizeOrDown, scale, subtract } from '../core/vec3';

/*
 * Placement and safety policy that still runs in TypeScript (U5 moves landings and the generic
 * policy, U7 the safety verdicts): which automatic supports a no-support zone or a landing rule
 * (dental: the secondary contact must land on an approved side) leaves out. The decisions use the
 * same landings the build uses; the Rust build applies them (`omit_contacts`, `omit_trees`) and
 * reports them as `dropped`. TODO(U7): the verdict becomes part of the Rust `generate` call.
 */

export interface OmissionInput {
  /** Contacts with their sampled normals. */
  contacts: readonly SupportContact[];
  settings: Readonly<LiveSupportSettings>;
  tipOnly: boolean;
  layout: AutoTreeLayout | undefined;
  /** Where the column of contact `index` lands on the model (its own shape settings applied). */
  columnHit(index: number): Landing | undefined;
  treeHit(tree: AutoTree): Landing | undefined;
  zones?: readonly ZoneStamp[];
  landingAllowed?: (landing: Landing) => boolean;
}

export interface Omissions {
  /** Contact indices left out, ascending. */
  contacts: number[];
  /** Layout tree indices left out. */
  trees: number[];
  /** Contact indices left out specifically by a no-support zone, ascending. */
  byZones: number[];
}

export function hostPolicyActive(zones: readonly ZoneStamp[] | undefined, landingAllowed: unknown): boolean {
  return zones?.some((stamp) => stamp.kind === 'paint') === true || landingAllowed !== undefined;
}

export function hostOmissions(input: OmissionInput): Omissions {
  const { contacts, settings, layout, tipOnly } = input;
  const zones = input.zones?.some((stamp) => stamp.kind === 'paint') ? input.zones : undefined;
  const zoned = (landing: Landing | undefined) => zones !== undefined && landing !== undefined && zonedAt(zones, landing.point, landing.normal);
  const rejected = (landing: Landing | undefined) => landing !== undefined && input.landingAllowed !== undefined && !input.landingAllowed(landing);
  const dropped = new Set<number>();
  const byZones = new Set<number>();
  const blocked = new Set<number>();
  layout?.trees.forEach((tree, t) => {
    const hit = input.treeHit(tree);
    if (zoned(hit)) {
      for (const member of tree.members) byZones.add(member);
      blocked.add(t);
    } else if (rejected(hit)) blocked.add(t);
  });
  for (const t of blocked) for (const member of layout!.trees[t]!.members) dropped.add(member);
  const inTree = new Set(layout?.trees.flatMap((tree) => tree.members));
  const treeOf = new Set<number>();
  if (!tipOnly) layout?.trees.forEach((tree, t) => { if (!blocked.has(t)) for (const member of tree.members) treeOf.add(member); });

  const raftTop = settings.raftEnabled ? settings.raftFloorThickness : 0;
  contacts.forEach((contact, index) => {
    if (treeOf.has(index) || layout?.removed.has(index) || dropped.has(index)) return;
    const own = withShape(settings, contact.shape);
    // A contact whose tip would sit on the raft builds nothing, so it is never judged.
    const tip = subtract(contact.position, scale(normalizeOrDown(contact.normal), tipDepth(own)));
    if (tip[1] <= raftTop) return;
    const landing = input.columnHit(index);
    if (contact.origin !== 'manual' && !inTree.has(index) && (zoned(landing) || rejected(landing))) {
      if (zoned(landing)) byZones.add(index);
      dropped.add(index);
    }
  });
  const ascending = (set: Set<number>) => [...set].sort((a, b) => a - b);
  return { contacts: ascending(dropped), trees: ascending(blocked), byZones: ascending(byZones) };
}
