import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupportJob } from '../core/jobs';
import { GOLDEN_FIXTURES } from '../goldens/fixtures';
import { supportedUnit } from '../goldens/pipeline';
import { exportRefusal } from '../supports/exportGate';
import { runSupportJob } from '../supports/jobRunner';
import { supportJobOf } from '../supports/unitSupports';
import { nodeEngine } from '../../scripts/test-support/rustImport';
import { SupportMeshClient } from './meshClient';
import type { WorkerLike } from './WorkerTask';

/*
 * U8, one result path: the real mesh worker (`meshWorker.ts`, the same `runSupportJob` -> `generate`
 * the app and the goldens use) driven in-process. A worker here is paused: a request waits in its
 * inbox until `step()` runs it, and its reply waits in the outbox until `flush()` delivers it, so a
 * test can cancel or replace a request after `generate` has finished and before anything reached
 * the host. A terminated worker delivers nothing.
 */

vi.mock('./geometryClient', () => ({ geometryReady: () => Promise.resolve({}) }));

interface Scope { onmessage: ((event: { data: unknown }) => Promise<void> | void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
const scope: Scope = { onmessage: null, postMessage: () => {} };

class PausedWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  private inbox: unknown[] = [];
  private outbox: unknown[] = [];
  postMessage(message: unknown): void { this.inbox.push(message); }
  terminate(): void { this.terminated = true; }
  /** Runs the oldest request to completion in the real worker; its reply stays in the outbox. */
  async step(): Promise<void> {
    const message = this.inbox.shift();
    scope.postMessage = (reply) => { this.outbox.push(reply); };
    await scope.onmessage!({ data: message });
  }
  flush(): void {
    for (const reply of this.outbox.splice(0)) if (!this.terminated) this.onmessage?.({ data: reply });
  }
}

const workers: PausedWorker[] = [];
const client = (mode: 'persistent' | 'per-job' = 'persistent') => new SupportMeshClient({
  create: () => { const worker = new PausedWorker(); workers.push(worker); return worker; },
  mode,
});
const label = { key: 'Building supports for {name}', vars: { name: 'A' } };

const fixture = GOLDEN_FIXTURES.find((entry) => entry.name === 'cube-overhang')!;
const unit = supportedUnit(fixture, 'default');
const previewJob = (): SupportJob => supportJobOf(unit, 0, 'preview');
const contactIds = (mesh: { components: Array<{ contactId?: string | undefined }> }) => [...new Set(mesh.components.map((component) => component.contactId ?? '-'))].sort();

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('./meshWorker');
});

afterEach(() => { workers.length = 0; });

describe('one result path: lifecycle', () => {
  it('the live handle counter sees a mesh loaded and a session dropped', () => {
    const session = new nodeEngine.GeometrySession(1 << 20);
    const handle = session.load_mesh(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), Uint32Array.of(0, 1, 2));
    expect(nodeEngine.live_mesh_handles()).toBe(1);
    session.release_mesh(handle);
    expect(nodeEngine.live_mesh_handles()).toBe(0);
    session.load_mesh(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), Uint32Array.of(0, 1, 2));
    session.free();
    expect(nodeEngine.live_mesh_handles()).toBe(0);
  });

  it('cancel mid-generate then a new request: only the newest revision is delivered, no WASM handle stays', async () => {
    expect(nodeEngine.live_mesh_handles()).toBe(0);
    const c = client();
    const first = c.build('a', previewJob(), label);
    await Promise.resolve();
    await workers[0]!.step(); // generate has finished in the worker; nothing reached the host yet
    c.cancel('a');
    expect(workers[0]!.terminated).toBe(true);
    workers[0]!.flush(); // a late reply of the terminated worker
    await expect(first).resolves.toBeUndefined();

    const second = c.build('a', previewJob(), label);
    await Promise.resolve();
    await workers[1]!.step();
    workers[1]!.flush();
    const mesh = await second;
    expect(mesh).toBeDefined();
    // The cancel retired revision 1 (and took 2 so a reply of the old request can never match): the new one is later.
    expect(mesh!.revision).toBeGreaterThan(2);
    expect(mesh!.verdict?.status).toBeDefined();
    // The same contacts and verdict as a direct run of the job (what the goldens use).
    const direct = runSupportJob(previewJob(), undefined, mesh!.revision);
    expect(contactIds(mesh!)).toEqual(contactIds(direct));
    expect(mesh!.verdict?.status).toBe(direct.verdict?.status);
    expect(nodeEngine.live_mesh_handles()).toBe(0);
    c.dispose();
  });

  it('a replaced request that finished generating is dropped by its revision, the newer one is delivered', async () => {
    const c = client();
    const old = c.build('a', previewJob(), label);
    await Promise.resolve();
    await workers[0]!.step();
    const newer = c.build('a', previewJob(), label);
    workers[0]!.flush();
    await expect(old).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await workers[0]!.step();
    workers[0]!.flush();
    await expect(newer).resolves.toMatchObject({ revision: 2 });
    expect(nodeEngine.live_mesh_handles()).toBe(0);
    c.dispose();
  });
});

describe('one result path: preview == export', () => {
  for (const variant of ['default', 'tree', 'roof', 'low-poly'] as const) {
    it(`${fixture.name}.${variant}: same contact IDs, dropped lists and verdicts; export echoes its revision`, async () => {
      const supported = supportedUnit(fixture, variant);
      const preview = runSupportJob(supportJobOf(supported, 0, 'preview'), undefined, 1);
      const c = client('per-job');
      const exported = c.exportFiles(
        [{ unitId: supported.id, job: supportJobOf(supported, 0, 'export'), transform: supported.transform }],
        [{ fileName: 'a-supports.stl', parts: [{ unitId: supported.id, content: 'supports' }] }], label, () => {});
      await Promise.resolve();
      await workers[0]!.step();
      workers[0]!.flush();
      const outcome = await exported;
      const [result] = outcome.units;
      expect(result).toMatchObject({ unitId: supported.id, revision: outcome.revision, verdict: preview.verdict?.status, islands: preview.islands?.status });
      const direct = runSupportJob(supportJobOf(supported, 0, 'export'), undefined, outcome.revision);
      expect(contactIds(direct)).toEqual(contactIds(preview));
      expect(direct.dropped).toEqual(preview.dropped);
      expect(direct.verdict?.status).toBe(preview.verdict?.status);
      expect(direct.islands?.status).toBe(preview.islands?.status);
      if (variant !== 'low-poly') expect(direct.components.map((c) => [c.part, c.contactId, c.count])).toEqual(preview.components.map((c) => [c.part, c.contactId, c.count]));
      expect(exportRefusal(outcome, [supported.id], () => true)).toBeUndefined();
      expect(outcome.files).toHaveLength(1);
      expect(nodeEngine.live_mesh_handles()).toBe(0);
    }, 60_000);
  }
});
