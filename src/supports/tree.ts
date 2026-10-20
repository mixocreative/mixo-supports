type Vector = [number, number, number];

/** Where a support leaves its neck and would otherwise start a vertical pillar. */
export interface TreeAnchor {
  id: string;
  position: Vector;
}

export interface TreeOptions {
  mergeDistance: number;
  branchDescent: number;
  /** Lowest allowed junction height, normally the top of the foot. */
  floor?: number;
}

export type TreeRecord =
  | { kind: 'pillar'; contactId: string; from: Vector; to: Vector }
  | { kind: 'junction'; id: string; position: Vector; contactIds: string[] }
  | { kind: 'branch'; contactId: string; junctionId: string; from: Vector; to: Vector }
  | { kind: 'trunk'; junctionId: string; from: Vector; to: Vector; memberCount: number };

/**
 * Deterministic tree layout: anchors join the first cluster whose centroid lies within
 * the merge distance (XZ). Each cluster of two or more meets at a junction that sits
 * `branchDescent` below its lowest anchor and continues to the plate as one trunk.
 */
export function buildTreeTopology(anchors: readonly TreeAnchor[], options: TreeOptions): TreeRecord[] {
  const floor = options.floor ?? 0;
  const clusters: TreeAnchor[][] = [];
  for (const anchor of anchors) {
    const cluster = clusters.find((members) => {
      const [x, , z] = centroid(members);
      return Math.hypot(anchor.position[0] - x, anchor.position[2] - z) <= options.mergeDistance;
    });
    if (cluster) cluster.push(anchor); else clusters.push([anchor]);
  }

  const records: TreeRecord[] = [];
  for (const members of clusters) {
    const lowest = Math.min(...members.map((member) => member.position[1]));
    const junctionY = lowest - Math.max(0, options.branchDescent);
    if (members.length < 2 || junctionY <= floor) {
      for (const member of members) records.push(pillar(member));
      continue;
    }
    const [x, , z] = centroid(members);
    const id = `junction-${members[0]!.id}`;
    const position: Vector = [x, junctionY, z];
    records.push({ kind: 'junction', id, position, contactIds: members.map((member) => member.id) });
    for (const member of members) {
      records.push({ kind: 'branch', contactId: member.id, junctionId: id, from: [...member.position], to: [...position] });
    }
    records.push({ kind: 'trunk', junctionId: id, from: [...position], to: [x, 0, z], memberCount: members.length });
  }
  return records;
}

function pillar(anchor: TreeAnchor): TreeRecord {
  return { kind: 'pillar', contactId: anchor.id, from: [...anchor.position], to: [anchor.position[0], 0, anchor.position[2]] };
}

function centroid(members: readonly TreeAnchor[]): Vector {
  const sum = members.reduce<Vector>((total, member) => [
    total[0] + member.position[0], total[1] + member.position[1], total[2] + member.position[2],
  ], [0, 0, 0]);
  return [sum[0] / members.length, sum[1] / members.length, sum[2] / members.length];
}
