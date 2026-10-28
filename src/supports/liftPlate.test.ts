import { describe, expect, it } from 'vitest';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { GOLDEN_FIXTURES } from '../goldens/fixtures';
import { supportedUnit } from '../goldens/pipeline';
import type { PrintUnit, SceneCommand } from '../state/project';
import { BuildSessions } from '../workers/buildSessions';
import { nodeEngine } from '../../scripts/test-support/rustImport';
import { base, jobAt, liftedJob, mesh } from '../../scripts/test-support/referenceStep3';
import { runSupportJob } from './jobRunner';
import { generationPlate, generationTransform, liftCommands, resolveSettings, supportJobOf } from './unitSupports';

/*
 * Unit L, lift as a plate offset: after a lift change the supports are built on the frame they were
 * generated in with the plate moved, not on a model placed again. Same supports as a fresh generate
 * at that lift (unit-local, within float noise), and the build reuses the placed model and its caches.
 */

const engine = nodeEngine as unknown as { remesh_cache_stats(): Uint32Array; live_mesh_handles(): number };

/** Same supports: topology, parts, contacts, verdicts and islands exact, positions within 1e-5 mm. */
function expectSameSupports(moved: GeneratedSupportMesh, fresh: GeneratedSupportMesh): void {
  expect(moved.indices).toEqual(fresh.indices);
  expect(moved.positions.length).toBe(fresh.positions.length);
  let worst = 0;
  for (let k = 0; k < moved.positions.length; k += 1) worst = Math.max(worst, Math.abs(moved.positions[k]! - fresh.positions[k]!));
  expect(worst).toBeLessThanOrEqual(1e-5);
  const parts = (mesh: GeneratedSupportMesh) => mesh.components.map((c) => [c.part, c.contactId ?? '-', c.start, c.count].join(':'));
  expect(parts(moved)).toEqual(parts(fresh));
  expect([moved.dropped, moved.droppedByZones, moved.verdict]).toEqual([fresh.dropped, fresh.droppedByZones, fresh.verdict]);
  const islands = (mesh: GeneratedSupportMesh) => mesh.islands?.status === 'ok' ? mesh.islands.islands.map((i) => [i.vertex, i.status, Math.round(i.height * 1e4)]) : mesh.islands;
  expect(islands(moved)).toEqual(islands(fresh));
}

/** The unit after `commands` (the scene reducer's effect for the two command kinds a lift makes). */
function applied(unit: PrintUnit, commands: SceneCommand[]): PrintUnit {
  return commands.reduce((at, command) => {
    if (command.type === 'transform/set') return { ...at, transform: command.transform };
    if (command.type === 'supports/set') return { ...at, placement: command.placement, supports: command.supports };
    return at;
  }, unit);
}

describe('lift as a plate offset', () => {
  it('a lifted unit builds what a fresh generate at that lift builds (generic, Low Poly preview)', () => {
    const fixture = GOLDEN_FIXTURES.find((entry) => entry.name === 'knot')!;
    const placed = supportedUnit(fixture, 'low-poly');
    const settings = { ...resolveSettings(placed.settings), liftHeight: resolveSettings(placed.settings).liftHeight + 1.3, scatterAutoTree: true };
    const lifted = applied({ ...placed, settings }, liftCommands({ ...placed, settings }, settings)!);
    expect(generationTransform(lifted)).toEqual(generationTransform(placed));
    expect(generationPlate(lifted)).toBeCloseTo(-1.3, 9);
    // A fresh generate at the new height: the supports frame is the unit's own, the plate its own.
    const { plate: _plate, ...data } = lifted.supports!.data;
    const fresh: PrintUnit = { ...lifted, supports: { ...lifted.supports!, data: { ...data, transform: { position: [...lifted.transform.position], rotation: [...lifted.transform.rotation] } } } };
    expect(generationPlate(fresh)).toBe(0);
    const moved = runSupportJob(supportJobOf(lifted, 0));
    expect(moved.positions.length).toBeGreaterThan(0);
    expectSameSupports(moved, runSupportJob(supportJobOf(fresh, 0)));
  });

  it('the aligner (exact surface): a lift change builds what a fresh generate at that lift builds', () => {
    // Low Poly preview lands on the exact surface; with the voxel remesh a fresh generate at another
    // height is not a translated copy itself (its grid is aligned to the build frame), see below.
    const exact = { ...base, lowPolyMode: true };
    for (const change of [1.3, -1.5]) {
      const lifted = { ...exact, liftHeight: exact.liftHeight + change };
      expectSameSupports(runSupportJob(liftedJob(lifted, exact)), runSupportJob(jobAt(lifted)));
    }
  });

  it('the aligner: a lift change reuses the placed model and its remesh and keeps the generated tips', () => {
    const sessions = new BuildSessions();
    try {
      const site = sessions.site('aligner', 1, mesh, 1);
      const generated = jobAt(base);
      const first = runSupportJob(generated, undefined, 0, site);
      const copy = site.placed(generated.frame!);
      const handles = engine.live_mesh_handles();
      const [hits, misses] = engine.remesh_cache_stats();
      const moved = runSupportJob(liftedJob({ ...base, liftHeight: base.liftHeight + 1 }, base), undefined, 0, site);
      // No new placed copy (same handle, same handle count) and the remesh came from the cache.
      expect(site.placed(generated.frame!)).toBe(copy);
      expect(engine.live_mesh_handles()).toBe(handles);
      const [hitsAfter, missesAfter] = engine.remesh_cache_stats();
      expect(missesAfter).toBe(misses);
      expect(hitsAfter).toBeGreaterThan(hits!);
      // The same contacts with the same tips and necks; only what reaches the plate grew by the lift.
      const tips = (mesh: GeneratedSupportMesh) => mesh.components.filter((c) => c.part === 'tip' || c.part === 'neck').map((c) => [c.contactId, Array.from(mesh.indices.subarray(c.start, c.start + c.count), (v) => mesh.positions.subarray(v * 3, v * 3 + 3).join()).join(';')].join('|'));
      expect(tips(moved)).toEqual(tips(first));
      expect([moved.dropped, moved.verdict?.status]).toEqual([first.dropped, first.verdict?.status]);
      const lowest = (mesh: GeneratedSupportMesh) => mesh.positions.filter((_, k) => k % 3 === 1).reduce((low, y) => Math.min(low, y), Infinity);
      expect(lowest(moved)).toBeCloseTo(lowest(first) - 1, 4);
    } finally {
      sessions.clear();
    }
  });
});
