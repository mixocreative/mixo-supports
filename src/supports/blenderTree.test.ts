import { describe, expect, it } from 'vitest';
import reference from '../../tools/blender-parity/reference.json';
import { autoTrees, type SupportContact } from './mesh';
import { defaultSupportSettings, type LiveSupportSettings } from './settings';

/**
 * Auto Tree against Resin UV (tools/blender-parity/probe.py cases tree_*): junction layout
 * (cluster, average, descent, surface snap) and every branch curve ring by ring.
 * Blender (x, y, z) = web (x, -z, y).
 */
type Vec3 = [number, number, number];
interface TreeCase {
  settings: Record<string, number | boolean | string>;
  contacts: Vec3[];
  columns: { foot_center: [number, number] }[];
  graph: { vertices: Vec3[]; edges: [number, number][] };
  tree_pieces: { n: number; rings: [number, number, number, number][] | null }[];
  classes: { co: Vec3; class: 'face' | 'edge' | 'vertical' }[];
}
const cases = Object.entries((reference as unknown as { cases: Record<string, TreeCase> }).cases).filter(([, c]) => c.settings.scatter_auto_tree);
const toWeb = ([x, y, z]: readonly number[]): Vec3 => [x!, z!, -y!];
const toBlender = ([x, y, z]: readonly number[]): Vec3 => [x!, -z!, y!];

const EXACT_CURVES: Record<string, number> = { tree_default: 5, tree_wide: 1 };

describe.each(cases)('Blender %s', (name, blender) => {
  const settings: LiveSupportSettings = {
    ...defaultSupportSettings, roofSeededModes: [], scatterAutoTree: true,
    scatterMergeDistance: blender.settings.scatter_merge_distance as number,
    scatterBranchDescent: blender.settings.scatter_branch_descent as number,
    treeSectionIncrement: blender.settings.tree_section_increment as number,
  };
  const lift = blender.settings.lift_height as number;
  const spike = {
    positions: new Float32Array([0, lift, 0, -3, lift + 3, 3, 3, lift + 3, 3, 3, lift + 3, -3, -3, lift + 3, -3]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 1, 2, 3, 1, 3, 4]),
  };
  // The 17 scatter contacts come first in Blender's graph; the rest are junctions.
  const surface = (p: Vec3): Vec3 => {
    if (Math.abs(Math.abs(p[0]) - Math.abs(p[1])) < 1e-3) return [0, 0, -1];
    const s = Math.SQRT1_2;
    return Math.abs(p[0]) > Math.abs(p[1]) ? [Math.sign(p[0]) * s, 0, -s] : [0, Math.sign(p[1]) * s, -s];
  };
  const kind = (p: Vec3) => blender.classes.find((c) => Math.hypot(c.co[0] - p[0], c.co[1] - p[1], c.co[2] - p[2]) < 1e-3)!.class;
  const contacts: SupportContact[] = blender.graph.vertices.slice(0, 17).map((p, i) => ({ id: `c${i}`, position: toWeb(p), normal: toWeb(surface(p)), kind: kind(p) }));
  const trees = autoTrees(contacts, settings, spike);

  it('builds the same junctions with the same branches', () => {
    const blenderTrees = new Map<number, number[]>();
    for (const [a, b] of blender.graph.edges) {
      const [leaf, junction] = a < b ? [a, b] : [b, a];
      blenderTrees.set(junction, [...(blenderTrees.get(junction) ?? []), leaf].sort((x, y) => x - y));
    }
    expect(trees.length).toBe(blenderTrees.size);
    for (const { tree } of trees) {
      const match = [...blenderTrees].find(([, members]) => members.join() === tree.members.join());
      expect(match, `members ${tree.members}`).toBeDefined();
      const position = blender.graph.vertices[match![0]]!;
      expect(Math.hypot(...toBlender(tree.junction).map((v, axis) => v - position[axis]!))).toBeLessThan(0.01);
    }
  });

  it('reproduces each branch curve (tip, neck fillet, junction)', () => {
    const blenderCurves = blender.tree_pieces.filter((piece) => piece.rings && piece.rings.length >= 6 && piece.rings.some((r) => Math.abs(r[3] - settings.pillarDiameter / 2) < 1e-3)
      && piece.rings[0]![3] < 0.2 && piece.rings[piece.rings.length - 1]![3] < 0.2);
    const webCurves = trees.flatMap(({ geometry }) => geometry.curves.filter((curve) => curve.part === 'tree-branch'));
    expect(webCurves.length).toBe(blenderCurves.length);
    let exact = 0;
    for (const curve of webCurves) {
      const nodes = curve.nodes.map((node) => [...toBlender(node.point), node.radius]);
      const tip = nodes[0]!;
      const piece = blenderCurves.find((p) => [p.rings![0]!, p.rings![p.rings!.length - 1]!].some((r) => Math.hypot(r[0] - tip[0]!, r[1] - tip[1]!, r[2] - tip[2]!) < 1e-3))!;
      expect(piece, `tip ${tip}`).toBeDefined();
      let rings = piece.rings!;
      if (Math.hypot(rings[0]![0] - tip[0]!, rings[0]![1] - tip[1]!) > 1e-3) rings = [...rings].reverse();
      expect(nodes.length).toBe(rings.length);
      const error = Math.max(...nodes.map((node, i) => Math.hypot(node[0]! - rings[i]![0], node[1]! - rings[i]![1], node[2]! - rings[i]![2])));
      nodes.forEach((node, i) => expect(Math.abs(node[3]! - rings[i]![3])).toBeLessThan(0.01));
      // The tip and the radii always match; the path matches wherever the neck normal does.
      expect(error).toBeLessThan(0.6);
      if (error < 0.005) exact += 1;
    }
    // Blender's remesh uses adaptivity 0.1, which merges flat voxel regions; ours is the
    // adaptivity-0 mesh (vertex for vertex). Contacts whose nearest remesh face or edge was
    // merged (the face contact near the apex edge, and rim contacts on the negative side where
    // the top face lies on a voxel plane) get a neck up to ~0.6 mm off.
    expect(exact).toBeGreaterThanOrEqual(EXACT_CURVES[name]!);
  });
});
