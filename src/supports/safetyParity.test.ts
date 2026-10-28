import { describe, expect, it } from 'vitest';
import '../../scripts/test-support/useNodeEngine';
import type { TriangleMesh } from '../core/analysis/types';
import type { GeneratedSupportMesh, SupportContact } from '../core/supports/mesh';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import { alignerScenario } from '../../scripts/test-support/supportParityHarness';
import { approxArray, exactArray, expectGolden, readGolden } from '../../scripts/test-support/golden';
import { checkSupportProblems } from './checkSupports';
import { generateSupports } from './generateSupports';
import { testPolicy, type TestPolicy } from '../../scripts/test-support/testPolicy';
import type { Vector } from '../core/vec3';

/*
 * U7 parity (SHIP-PLAN rule 7): the Rust `generate` (permit, build, exact body check, bounded repair)
 * against RECORDED outputs of the TypeScript flow it replaced (scripts/fixtures/golden/safety-*.json, recorded from
 * the TS oracle in U9; regen with UPDATE_GOLDENS=1, see scripts/test-support/golden.ts). IDs, tags, dropped
 * lists, structure fallbacks and triangle indices identical; positions within 1e-5 mm.
 */

type V = [number, number, number];

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

/** The face of `model` whose plane holds `point` and whose normal opposes `normal` (the surface a contact is placed on). */
function faceAt(model: TriangleMesh, point: Vector, normal: Vector): number {
  for (let face = 0; face < model.indices.length / 3; face += 1) {
    const v = [0, 1, 2].map((k) => Array.from(model.positions.subarray(model.indices[face * 3 + k]! * 3, model.indices[face * 3 + k]! * 3 + 3)) as Vector);
    const [a, b, c] = v as [Vector, Vector, Vector];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const size = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (size === 0 || (n[0]! * normal[0] + n[1]! * normal[1] + n[2]! * normal[2]) / size < 0.9) continue;
    if (Math.abs(((point[0] - a[0]) * n[0]! + (point[1] - a[1]) * n[1]! + (point[2] - a[2]) * n[2]!) / size) > 1e-3) continue;
    const p = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
    const d00 = u[0]! * u[0]! + u[1]! * u[1]! + u[2]! * u[2]!, d01 = u[0]! * w[0]! + u[1]! * w[1]! + u[2]! * w[2]!, d11 = w[0]! * w[0]! + w[1]! * w[1]! + w[2]! * w[2]!;
    const d20 = p[0]! * u[0]! + p[1]! * u[1]! + p[2]! * u[2]!, d21 = p[0]! * w[0]! + p[1]! * w[1]! + p[2]! * w[2]!;
    const det = d00 * d11 - d01 * d01;
    const s = (d11 * d20 - d01 * d21) / det, t = (d00 * d21 - d01 * d20) / det;
    if (s >= -1e-6 && t >= -1e-6 && s + t <= 1 + 1e-6) return face;
  }
  throw new Error(`no face under ${point}`);
}

const contact = (model: TriangleMesh, id: string, position: V, origin?: 'manual'): SupportContact => {
  const normal: V = [0, -1, 0];
  return { id, position, normal, sourceFace: faceAt(model, position, normal), ...(origin ? { origin } : {}) };
};

const lowPoly = (extra: Partial<LiveSupportSettings> = {}): LiveSupportSettings =>
  ({ ...defaultSupportSettings, roofSeededModes: [], lowPolyMode: true, raftEnabled: false, scatterAutoTree: false, trussEnabled: false, ...extra }) as LiveSupportSettings;

/** What the dental policy hands the engine for exactly these contacts: each automatic one is its own candidate. */
function policyFor(contacts: readonly SupportContact[], settings: LiveSupportSettings, landing?: Uint8Array): TestPolicy {
  return {
    repairBudget: 8, automatic: 'match-candidates',
    structures: { pillar: true, tree: settings.scatterAutoTree, brace: settings.trussEnabled, roof: false, cage: false, raft: true },
    ...(landing ? { landing } : {}),
    candidates: contacts.filter((c) => c.origin !== 'manual').map((c) => ({ id: `candidate-${c.id}`, position: c.position, normal: c.normal, ...(c.sourceFace === undefined ? {} : { face: c.sourceFace }) })),
  };
}

const summary = (mesh: GeneratedSupportMesh) => ({
  components: mesh.components.map((c) => [c.part, c.contactId, c.structureKind, c.start, c.count]),
  dropped: mesh.dropped, droppedByZones: mesh.droppedByZones ?? [], fallback: mesh.dentalStructureFallback ?? [],
});

const seen = { dropped: 0, braceFallback: 0, treeBuilt: 0, builds: 0 };

const slug = (name: string) => `safety-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

function parity(name: string, model: TriangleMesh, contacts: SupportContact[], settings: LiveSupportSettings, landingFaces?: Uint8Array, mode: 'preview' | 'export' = 'preview') {
  const out = generateSupports(contacts, settings, testPolicy(policyFor(contacts, settings, landingFaces)), { mode, model, labelText: 'A' });
  const mesh = { ...out.mesh, ...(out.fallback.length > 0 ? { dentalStructureFallback: out.fallback } : {}) };
  // Contacts that were not moved or dropped keep their input order, so contact IDs and tags compare directly.
  expectGolden(slug(name), { ...summary(mesh), indices: exactArray(mesh.indices, 'u32'), positions: approxArray(mesh.positions, mesh.positions.length > 30000 ? 41 : 1) });
  seen.builds += 1;
  seen.dropped += mesh.dropped.length;
  seen.braceFallback += mesh.dentalStructureFallback?.some((f) => f !== 'tree') ? 1 : 0;
  seen.treeBuilt += mesh.components.some((c) => c.part === 'tree-branch') ? 1 : 0;
  return { ts: mesh, out };
}

describe('generate against the TS safety flow: synthetic models', () => {
  const walls = boxes([[-5, 20, -5], [5, 24, 5]], [[-20, 0, -5], [-0.3, 12, 5]], [[0.3, 0, -5], [20, 12, 5]]);

  it('two walls: a crossing automatic contact is left out, a manual one is kept (the verdict names it)', () => {
    const contacts = [contact(walls, 'auto-a', [0, 20, 0.5]), contact(walls, 'manual-b', [3, 20, 0.5], 'manual'), contact(walls, 'auto-c', [-3, 20, 3])];
    const { ts, out } = parity('two-walls', walls, contacts, lowPoly());
    expect(ts.dropped).toContain('auto-a');
    expect(ts.components.some((c) => c.contactId === 'manual-b')).toBe(true);
    expect(out.mesh.verdict?.status).toBeDefined();
  });

  it('a brace through the model is pruned (every segment crosses here), the contacts stay', () => {
    const wall = boxes([[-9, 20, -5], [9, 24, 5]], [[-0.4, 0, -5], [0.4, 19, 5]]);
    const contacts = [contact(wall, 'auto-l', [-6, 20, 0]), contact(wall, 'auto-r', [6, 20, 0])];
    const { ts } = parity('brace', wall, contacts, lowPoly({ trussEnabled: true, trussMinHeight: 1 }));
    expect(ts.dentalStructureFallback).toEqual(['brace-pruned']);
    expect(ts.components.some((c) => c.part === 'brace')).toBe(false);
    expect(ts.dropped).toEqual([]);
  });

  it.each([['round tips', {}], ['shaped tips', { tipSection: 'SQUARE' as const }]])('a tree with both leaves on its own surface stays (%s)', (name, extra) => {
    const shelf = boxes([[-9, 20, -5], [9, 24, 5]]);
    const contacts = [contact(shelf, 'auto-l', [-0.3, 20, 0]), contact(shelf, 'auto-r', [0.3, 20, 0])];
    const { ts } = parity(`tree ${name}`, shelf, contacts, lowPoly({ scatterAutoTree: true, ...extra }));
    expect(ts.components.some((c) => c.part === 'tree-branch')).toBe(true);
    expect(ts.dentalStructureFallback).toBeUndefined();
  });

  it('a landing rule as a face mask drops the contact that would land off the approved faces', () => {
    const slab = boxes([[-5, 20, -5], [5, 24, 5]], [[-20, 5, -20], [20, 9, 20]]);
    const none = new Uint8Array(slab.indices.length / 3);
    const contacts = [contact(slab, 'auto-shelf', [0, 20, 0.5])];
    const { ts } = parity('landing denied', slab, contacts, lowPoly(), none);
    expect(ts.dropped).toEqual(['auto-shelf']);
    parity('landing allowed', slab, contacts, lowPoly(), new Uint8Array(slab.indices.length / 3).fill(1));
  });

  it('export mode builds the same', () => {
    parity('two-walls export', walls, [contact(walls, 'auto-a', [0, 20, 0.5]), contact(walls, 'auto-c', [-3, 20, 3])], lowPoly(), undefined, 'export');
  });
});

describe('generate against the TS safety flow: the reference aligner', () => {
  it('builds the same mesh, drops and fallbacks as the TS flow, and reports a verdict and island report', () => {
    const scenario = alignerScenario('preview', true)!;
    // The secondary landing mask the TS rule produced on the reference aligner (an input of the Rust call), run-length coded.
    const { count, runs } = readGolden<{ count: number; runs: number[] }>('safety-aligner-landing-mask');
    const mask = new Uint8Array(count);
    let at = 0;
    runs.forEach((length, k) => { if (k % 2 === 1) mask.fill(1, at, at + length); at += length; });
    expect(count).toBe(scenario.model.indices.length / 3);
    const { out } = parity('aligner', scenario.model, scenario.contacts, scenario.settings, mask);
    expect(out.mesh.components.length).toBeGreaterThan(200);
    expect(out.mesh.verdict?.status).toMatch(/^(clear|blocked|inconclusive)$/);
    expect(out.mesh.islands?.status).toMatch(/^(ok|inconclusive)$/);
    expect(out.trials).toBeLessThanOrEqual(8);
  }, 900_000);
});

describe('support check against the recorded TS check', () => {
  const same = (name: string, mesh: TriangleMesh, contacts: Vector[], settings = { overhangAngleDegrees: 45, spacing: 2 }) => {
    const rust = checkSupportProblems(mesh, contacts, settings);
    expectGolden(slug(`check ${name}`), rust.map((p) => [p.kind, ...p.position, p.area]));
    return rust.length;
  };

  it('matches on boxes, on a covered underside and on a lone island', () => {
    const box = boxes([[-5, 5, -5], [5, 15, 5]]);
    expect(same('unsupported box', box, [])).toBeGreaterThan(0);
    const lattice: Vector[] = [];
    for (let x = -4; x <= 4; x += 2) for (let z = -4; z <= 4; z += 2) if (x < 2 || z < 2) lattice.push([x, 5, z]);
    same('partly covered', box, lattice);
    same('another spacing', box, lattice, { overhangAngleDegrees: 30, spacing: 3 });
  });

  it('matches on the golden fixtures and the reference aligner', () => {
    const scenario = alignerScenario('preview', true)!;
    expect(same('aligner, no contacts', scenario.model, [])).toBeGreaterThan(0);
    same('aligner, contacts', scenario.model, scenario.contacts.map((c) => c.position), { overhangAngleDegrees: 45, spacing: 4 });
  }, 120_000);
});

describe('not vacuous', () => {
  it('compared a dropped contact, a brace fallback, a built tree and real builds', () => {
    expect(seen.dropped).toBeGreaterThan(0);
    expect(seen.braceFallback).toBeGreaterThan(0);
    expect(seen.treeBuilt).toBeGreaterThan(0);
    expect(seen.builds).toBeGreaterThan(6);
  });
});
