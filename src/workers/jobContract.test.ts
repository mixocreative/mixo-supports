import { describe, expect, it } from 'vitest';

/*
 * Shared heavy-mesh spec §5 contract: every job a client runs carries a human label (shown in the
 * job activity list), and every worker reports progress.
 */
const SOURCES = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true });

describe('worker job contract', () => {
  const clients = Object.entries(SOURCES).filter(([file, code]) => /Client\.ts$/.test(file) && /new WorkerTask\b/.test(code));
  const workers = Object.entries(SOURCES).filter(([file]) => /Worker\.ts$/.test(file));

  it('finds the clients and workers', () => {
    expect(clients.map(([file]) => file).sort()).toEqual(['./analysisClient.ts', './importClient.ts', './meshClient.ts', './projectClient.ts']);
    expect(workers.map(([file]) => file).sort()).toEqual(['./analysisWorker.ts', './importWorker.ts', './meshWorker.ts', './projectWorker.ts']);
  });

  it('labels every job a client runs', () => {
    for (const [file, code] of clients) {
      const runs = [...code.matchAll(/\.run\([\s\S]*?\}\)/g)];
      expect(runs.length, file).toBeGreaterThan(0);
      for (const [call] of runs) expect(call, file).toMatch(/\blabel\b/);
    }
  });

  it('has every worker serve the WorkerTask protocol and report progress', () => {
    for (const [file, code] of workers) {
      expect(code, file).toMatch(/serveTask</);
      expect(code, file).toMatch(/progress\(|post\(\{ fraction|throttled\(/);
    }
  });
});
