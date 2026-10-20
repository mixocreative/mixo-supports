import { describe, expect, it } from 'vitest';
import reference from '../../tools/blender-parity/reference_safe.json';
import { autoTreeLayout } from './autotree';
import { defaultSupportSettings, type LiveSupportSettings } from './settings';

/**
 * Auto Tree eligibility and Safe Distance against Resin UV on a ledge model
 * (tools/blender-parity/probe_safe.py). Blender (x, y, z) = web (x, z, -y).
 */
type Vec3 = [number, number, number];
interface SafeCase { scatter_auto_tree: boolean; scatter_safe_distance: number; graph: { vertices: Vec3[]; edges: [number, number][] } }
const data = reference as unknown as { settings: Record<string, number>; triangles: Vec3[][]; cases: Record<string, SafeCase> };
const toWeb = ([x, y, z]: readonly number[]): Vec3 => [x!, z!, -y!];
const lift = data.settings.lift_height!;

const positions = new Float32Array(data.triangles.flatMap((triangle) => triangle.flatMap(([x, y, z]) => [x!, z! + lift, -y!])));
const model = { positions, indices: new Uint32Array(positions.length / 3).map((_, i) => i) };
const contacts = data.cases.plain!.graph.vertices.map((p) => ({ position: toWeb(p) }));
const key = (p: readonly number[]) => p.map((v) => v.toFixed(2)).join(',');

// The ledge's faces lie on voxel planes, so on-surface nodes decide a few contacts: at Safe
// Distance 0.8 two contacts sit on the edge of the pulled-in lower arm (Blender drops them).
const TIES: Record<string, number> = { safe_0_8: 2 };

describe.each(Object.entries(data.cases).filter(([, c]) => c.scatter_auto_tree))('Blender %s', (name, blender) => {
  const settings: LiveSupportSettings = {
    ...defaultSupportSettings, roofSeededModes: [], scatterAutoTree: true,
    scatterSpacing: data.settings.scatter_spacing!,
    scatterAngle: data.settings.scatter_angle! * 180 / Math.PI,
    scatterMergeDistance: data.settings.scatter_merge_distance!,
    scatterBranchDescent: data.settings.scatter_branch_descent!,
    scatterSafeDistance: blender.scatter_safe_distance,
  };
  const layout = autoTreeLayout(contacts, model, settings);
  // Leaves have one edge; a junction joins two or more.
  const degree = new Map<number, number>();
  for (const v of blender.graph.edges.flat()) degree.set(v, (degree.get(v) ?? 0) + 1);
  const junctions = new Set([...degree].filter(([, d]) => d >= 2).map(([v]) => v));

  it('deletes the same contacts', () => {
    const kept = new Set(blender.graph.vertices.filter((_, i) => !junctions.has(i)).map((p) => key(toWeb(p))));
    const ours = new Set(contacts.filter((_, i) => !layout.removed.has(i)).map((c) => key(c.position)));
    const differing = [...[...ours].filter((k) => !kept.has(k)), ...[...kept].filter((k) => !ours.has(k))];
    expect(differing.length, differing.join(' ')).toBeLessThanOrEqual(TIES[name] ?? 0);
  });

  it('builds the same trees', () => {
    const blenderTrees = [...junctions].map((j) => ({
      junction: toWeb(blender.graph.vertices[j]!),
      members: blender.graph.edges.filter((e) => e.includes(j)).map(([a, b]) => key(toWeb(blender.graph.vertices[a === j ? b : a]!))).sort(),
    }));
    expect(layout.trees.length).toBe(blenderTrees.length);
    for (const tree of layout.trees) {
      const members = tree.members.map((m) => key(contacts[m]!.position)).sort();
      const match = blenderTrees.find((t) => t.members.join() === members.join());
      expect(match, members.join(' ')).toBeDefined();
      expect(Math.hypot(...tree.junction.map((v, axis) => v - match!.junction[axis]!))).toBeLessThan(0.01);
    }
  });
});
