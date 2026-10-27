import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import { buildSupportMesh, type SupportContact } from './mesh';
import { defaultSupportSettings } from '../../../../src/core/supports/settings';

const plain = { ...defaultSupportSettings, roofMode: 'OFF' as const, roofSeededModes: [],
  raftEnabled: false, trussEnabled: false, scatterAutoTree: false };

describe('buildSupportMesh proposed routes', () => {
  it('marks a pillar ending on the model as an uncertain intentional landing reach', () => {
    const model: TriangleMesh = {
      positions: new Float32Array([-20, 6, -20, 20, 6, -20, 0, 6, 20, 30, 0, 30]),
      indices: new Uint32Array([0, 2, 1]),
    };
    const contact: SupportContact = { id: 'auto-landing', position: [0, 12, 0], normal: [0, -1, 0] };
    let pillarReach: number | undefined;
    let pillarEndY: number | undefined;
    buildSupportMesh([contact], plain, { model, decideColumn: (proposal) => {
      const pillar = proposal.routes.find((route) => route.part === 'pillar');
      pillarReach = pillar?.uncertainEndMm;
      pillarEndY = pillar?.points.at(-1)?.[1];
      return 'build';
    } });
    expect(pillarEndY).toBeCloseTo(6 - plain.pointDepth);
    expect(pillarReach).toBeCloseTo(plain.neckLength);
  });

  it('can omit a rejected automatic column before emitting even its tip', () => {
    const contact: SupportContact = { id: 'auto-blocked', position: [0, 12, 0], normal: [0, -1, 0] };
    const seen: string[][] = [];
    const built = buildSupportMesh([contact], plain, { decideColumn: (proposal) => {
      seen.push(proposal.routes.map((route) => route.part));
      return 'omit';
    } });
    expect(seen).toEqual([['neck', 'pillar', 'pillar', 'foot']]);
    expect(built.positions).toHaveLength(0);
    expect(built.droppedByPath).toEqual(['auto-blocked']);
    expect(built.dropped).toEqual(['auto-blocked']);
  });

  it('never silently omits a manual column even if the decision requests it', () => {
    const contact: SupportContact = { id: 'manual-blocked', origin: 'manual', position: [0, 12, 0], normal: [0, -1, 0] };
    const built = buildSupportMesh([contact], plain, { decideColumn: () => 'omit' });
    expect(built.positions.length).toBeGreaterThan(0);
    expect(built.dropped).toEqual([]);
    expect(built.droppedByPath).toEqual([]);
  });

  it('reports the complete manual column path before meshing without changing its geometry', () => {
    const contact: SupportContact = { id: 'manual-1', origin: 'manual', position: [0, 12, 0], normal: [0, -1, 0] };
    const routes: Array<{ part: string; contactId?: string; origin?: string; points: readonly [number, number, number][]; radiusMm: number }> = [];
    const baseline = buildSupportMesh([contact], plain);
    const built = buildSupportMesh([contact], plain, { onRoute: (route) => routes.push(route) });
    const pillar = routes.find((route) => route.part === 'pillar');
    const foot = routes.find((route) => route.part === 'foot');
    expect(pillar).toMatchObject({ contactId: 'manual-1', origin: 'manual' });
    expect(pillar!.points[0]![1]).toBeGreaterThan(0);
    expect(pillar!.radiusMm).toBeCloseTo(plain.pillarDiameter / 2);
    expect(foot).toMatchObject({ contactId: 'manual-1', origin: 'manual' });
    expect(foot!.points.some((point) => point[1] === 0)).toBe(true);
    expect(foot!.radiusMm).toBeCloseTo(plain.baseDiameter / 2);
    expect(built.positions).toEqual(baseline.positions);
    expect(built.indices).toEqual(baseline.indices);
  });

  it('reports actual Tree branches and Brace segments before meshing', () => {
    const pair: SupportContact[] = [
      { id: 'a', position: [0, 40, 0], normal: [0, -1, 0] },
      { id: 'b', position: [1.5, 40, 0], normal: [0, -1, 0] },
    ];
    const treeRoutes: Array<{ part: string; points: readonly unknown[] }> = [];
    const tree = buildSupportMesh(pair, { ...plain, scatterAutoTree: true },
      { onRoute: (route) => treeRoutes.push(route) });
    expect(tree.parts).toContain('tree-branch');
    expect(treeRoutes.some((route) => route.part === 'tree-branch' && route.points.length >= 2)).toBe(true);

    const braceRoutes: Array<{ part: string; points: readonly unknown[]; radiusMm: number }> = [];
    const braces = buildSupportMesh([pair[0]!, { ...pair[1]!, position: [4, 40, 0] }],
      { ...plain, trussEnabled: true, trussSpacing: 2, trussMinHeight: 3, trussTopSpacing: 0 },
      { onRoute: (route) => braceRoutes.push(route) });
    expect(braces.parts).toContain('brace');
    expect(braceRoutes.some((route) => route.part === 'brace' && route.points.length === 2 && route.radiusMm > 0)).toBe(true);
  });

  it('does not let a route observer mutate the builder geometry', () => {
    const contact: SupportContact = { id: 'auto-1', position: [0, 12, 0], normal: [0, -1, 0] };
    const baseline = buildSupportMesh([contact], plain);
    const built = buildSupportMesh([contact], plain, { onRoute: (route) => {
      (route.points[0] as [number, number, number])[1] = 999;
    } });
    expect(built.positions).toEqual(baseline.positions);
  });
});
