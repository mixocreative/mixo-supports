import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import { lineTarget, treeLanding } from '../../../../src/core/supports/landing';
import { autoTrees, buildSupportMesh, type SupportContact } from './mesh';
import { defaultSupportSettings, type LiveSupportSettings } from '../../../../src/core/supports/settings';
import type { ZoneStamp } from '../../../../src/core/supports/zones';

type V = [number, number, number];

/** Outward-facing axis-aligned boxes as one mesh. */
function boxes(...list: [V, V][]): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [[x0, y0, z0], [x1, y1, z1]] of list) {
    const base = positions.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) positions.push(x!, y!, z!);
    for (const face of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) {
      indices.push(base + face[0]!, base + face[1]!, base + face[2]!, base + face[0]!, base + face[2]!, base + face[3]!);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const base = { ...defaultSupportSettings, roofSeededModes: [], raftEnabled: false, neckLength: 4 } as LiveSupportSettings;
const paint = (center: V, radius = 1, normal: V = [0, 1, 0]): ZoneStamp => ({ center, radius, normal, kind: 'paint' });
const builtIds = (mesh: { components: { contactId?: string }[] }) => new Set(mesh.components.flatMap((component) => (component.contactId ? [component.contactId] : [])));

describe('buildSupportMesh: a column landing in a no-support zone', () => {
  // A slab (top at y = 9) under a shelf (underside at y = 20).
  const model = boxes([[-20, 5, -20], [20, 9, 20]], [[-5, 20, -5], [5, 24, 5]]);
  // Placement tilted the contact's normal 30 degrees toward +x; the shelf underside is flat.
  const tilted: SupportContact = { id: 'auto-shelf', kind: 'face', position: [0, 20, 0], normal: [0.5, -Math.sqrt(3) / 2, 0] };
  // Bent by the raw normal, the column would drop at x = Connection Length x sin 30 = 2.
  const predicted: V = [2, 9, 0];
  // The build re-samples the normal on the remesh (straight down), so the column really drops at x = 0.
  const real: V = [0, 9, 0];
  const build = (zones: ZoneStamp[], overrides: Partial<LiveSupportSettings> = {}, contacts: SupportContact[] = [tilted], mode: 'preview' | 'export' = 'preview') =>
    buildSupportMesh(contacts, { ...base, ...overrides }, { model, zones, mode });

  it('drops an automatic column by where the build really lands it, not by the raw-normal prediction', () => {
    expect(build([]).dropped).toEqual([]);
    const atReal = build([paint(real)]);
    expect(atReal.dropped).toEqual(['auto-shelf']);
    expect(atReal.droppedByZones).toEqual(['auto-shelf']);
    expect(builtIds(atReal).has('auto-shelf')).toBe(false);
    const atPredicted = build([paint(predicted)]);
    expect(atPredicted.dropped).toEqual([]);
    expect(builtIds(atPredicted).has('auto-shelf')).toBe(true);
    // Export lands it on the same remesh, so it drops the same contacts.
    expect(build([paint(real)], {}, [tilted], 'export').dropped).toEqual(['auto-shelf']);
    expect(build([paint(predicted)], {}, [tilted], 'export').dropped).toEqual([]);
  });

  it('a Low Poly preview lands on the exact model with the raw normal, and decides by that landing', () => {
    expect(build([paint(predicted)], { lowPolyMode: true }).dropped).toEqual(['auto-shelf']);
    expect(build([paint(real)], { lowPolyMode: true }).dropped).toEqual([]);
  });

  it('a tips-only preview drops the same contacts as the full build', () => {
    expect(build([paint(real)], { previewMode: 'ONLY_TIP' }).dropped).toEqual(['auto-shelf']);
    expect(build([paint(predicted)], { previewMode: 'ONLY_TIP' }).dropped).toEqual([]);
  });

  it('never drops a manual support; it still lands in the zone', () => {
    const manual: SupportContact = { ...tilted, id: 'manual-shelf', origin: 'manual' };
    const mesh = build([paint(real)], {}, [manual]);
    expect(mesh.dropped).toEqual([]);
    expect(builtIds(mesh).has('manual-shelf')).toBe(true);
  });

  it('keeps the same-side rule and erase: a zone under the slab top, or erased again, drops nothing', () => {
    expect(build([paint(real, 1, [0, -1, 0])]).dropped).toEqual([]);
    expect(build([paint(real), { ...paint(real), kind: 'erase' }]).dropped).toEqual([]);
  });

  it('builds exactly the same mesh with no paint stamps', () => {
    const plain = buildSupportMesh([tilted], base, { model });
    const erased = build([{ ...paint(real), kind: 'erase' }]);
    expect(Array.from(erased.indices)).toEqual(Array.from(plain.indices));
    expect(Array.from(erased.positions)).toEqual(Array.from(plain.positions));
  });

  it('drops an automatic column when its secondary model landing is forbidden, including tips-only preview', () => {
    const exact = lineTarget(model, { ...base, lowPolyMode: true });
    const faceIndex = exact.cast([0, 18, 0], exact.height)?.faceIndex;
    expect(faceIndex).toBeDefined();
    const deny = (landing: { faceIndex?: number }) => landing.faceIndex === undefined;
    expect(buildSupportMesh([tilted], { ...base, lowPolyMode: true }, { model, landingAllowed: deny }).dropped).toEqual(['auto-shelf']);
    expect(buildSupportMesh([tilted], { ...base, lowPolyMode: true }, { model, landingAllowed: deny }).droppedByZones).toEqual([]);
    expect(buildSupportMesh([tilted], { ...base, lowPolyMode: true, previewMode: 'ONLY_TIP' }, { model, landingAllowed: deny }).dropped).toEqual(['auto-shelf']);
    expect(buildSupportMesh([tilted], { ...base, lowPolyMode: true }, { model, landingAllowed: () => true }).dropped).toEqual([]);
  });

  it('retains the exact source-face point when a remesh moves the visible landing', () => {
    const from: V = [0, 18, 0];
    const exact = lineTarget(model, { ...base, lowPolyMode: true }).cast(from, 20);
    const remeshed = lineTarget(model, { ...base, lowPolyMode: false }).cast(from, 20);
    expect(exact?.faceIndex).toBeDefined();
    expect(remeshed?.faceIndex).toBe(exact?.faceIndex);
    expect(remeshed?.sourcePoint).toEqual(exact?.point);
  });
});

describe('buildSupportMesh: an Auto Tree landing in a no-support zone', () => {
  // A shelf (underside y = 30) with a thin post below it (top y = 25). Two contacts beside the post
  // merge into a tree whose junction snaps onto the post top and lands there; two more, further out,
  // make a tree that does not reach the post.
  const model = boxes([[-12, 30, -12], [12, 34, 12]], [[-0.5, 5, -0.5], [0.5, 25, 0.5]]);
  const settings = { ...defaultSupportSettings, roofSeededModes: [], scatterAutoTree: true, lowPolyMode: true } as LiveSupportSettings;
  const contacts: SupportContact[] = [-0.9, 0.9, 7.1, 8.9].map((x) => ({ id: `auto-${x}`, position: [x, 30, 0], normal: [0, -1, 0], origin: 'auto' }));
  const ray = lineTarget(model, settings);
  const landed = autoTrees(contacts, settings, model).flatMap(({ tree }) => {
    const hit = treeLanding(tree, settings, ray).hit;
    return hit ? [{ tree, hit }] : [];
  });

  it('drops every branch of a tree whose junction lands in the zone, and only those', () => {
    expect(landed.length).toBeGreaterThan(0);
    const target = landed[0]!.hit.point;
    const zone = paint(target, 0.4);
    const expected = landed.filter(({ hit }) => Math.hypot(hit.point[0] - target[0], hit.point[1] - target[1], hit.point[2] - target[2]) <= 0.4)
      .flatMap(({ tree }) => tree.members).sort((a, b) => a - b).map((index) => contacts[index]!.id);
    expect(expected).toEqual(['auto--0.9', 'auto-0.9']);
    expect(buildSupportMesh(contacts, settings, { model }).dropped).toEqual([]);
    const mesh = buildSupportMesh(contacts, settings, { model, zones: [zone] });
    expect(mesh.dropped).toEqual(expected);
    const built = builtIds(mesh);
    for (const id of expected) expect(built.has(id)).toBe(false);
    // The other trees still stand.
    expect(contacts.filter((contact) => !expected.includes(contact.id)).some((contact) => built.has(contact.id))).toBe(true);
    // A tips-only preview draws tree members as columns, but drops the same ones.
    expect(buildSupportMesh(contacts, { ...settings, previewMode: 'ONLY_TIP' }, { model, zones: [zone] }).dropped).toEqual(expected);
  });

  it('drops all automatic tree members when the tree lands on a forbidden model face', () => {
    const forbidden = landed[0]!.hit.faceIndex;
    expect(forbidden).toBeDefined();
    const filtered = buildSupportMesh(contacts, settings, { model, landingAllowed: (hit) => hit.faceIndex !== forbidden });
    expect(filtered.dropped).toEqual(['auto--0.9', 'auto-0.9']);
  });
});
