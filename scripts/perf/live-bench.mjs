// Live-update bench (E1): how long a Step 2 or Step 3 change takes to reach the preview on the
// reference aligner, in headless Chromium against the dev server, and which worker jobs it ran.
// Run: npm run wasm:build && node scripts/perf/live-bench.mjs [runs]
//
// Method: every worker `run` message the page posts and every `done`/`error` reply is timestamped
// by a Worker wrapper (init script). A change starts the clock at the key press or click; it ends
// at the last worker reply once no job has been in flight for 600 ms (the preview debounces are
// inside the measured time). Each change runs `runs` times (default 3; it alternates direction);
// the median is reported with every sample and the jobs one change posted.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNS = Number(process.argv[2] ?? 3);
const REFERENCE = path.join(ROOT, 'docs', 'dental-reference', 'reference-aligner.stl');

async function freePort(from) {
  for (let port = from; port < from + 40; port += 1) {
    const free = await new Promise((resolve) => {
      const server = createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error(`no free port from ${from}`);
}

function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright') : path.join(homedir(), '.cache/ms-playwright'));
  if (!existsSync(base)) return undefined;
  const exe = process.platform === 'win32' ? 'chrome-win64/chrome.exe' : 'chrome-linux/chrome';
  return readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map((name) => path.join(base, name, exe)).find(existsSync);
}

/** Page script: timestamps of every worker job posted and answered. */
function recordJobs() {
  const Real = window.Worker;
  window.__jobs = [];
  window.Worker = class extends Real {
    constructor(url, options) {
      super(url, options);
      const worker = String(url).match(/(\w+Worker)/)?.[1] ?? 'worker';
      const open = new Map();
      this.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || (data.type !== 'done' && data.type !== 'error')) return;
        const job = open.get(data.id);
        if (job) { job.end = performance.now(); open.delete(data.id); }
      });
      const post = this.postMessage.bind(this);
      this.postMessage = (message, transfer) => {
        if (message?.type === 'run') {
          const job = { worker, kind: message.payload?.kind ?? '?', start: performance.now() };
          open.set(message.id, job);
          window.__jobs.push(job);
        }
        return post(message, transfer);
      };
      const terminate = this.terminate.bind(this);
      this.terminate = () => { for (const job of open.values()) job.end = job.end ?? -1; open.clear(); return terminate(); };
    }
  };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function main() {
  const port = await freePort(5320);
  const url = `http://127.0.0.1:${port}/`;
  const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; ; i += 1) {
      try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
      if (i > 120) throw new Error('Vite did not serve');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
    browser = await chromium.launch({ headless: true, args }).catch(() => chromium.launch({ headless: true, args, executablePath: chromiumPath() }));
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => { try { localStorage.setItem('mixo-supports.lang', 'en'); } catch { /* storage off */ } });
    await context.addInitScript(recordJobs);
    const page = await context.newPage();
    if (process.env.E1_LOG) page.on('console', (m) => { if (m.text().startsWith('[E1]')) console.log(m.text()); });
    const button = (name) => page.getByRole('button', { name, exact: true }).first();
    const stepTo = (word, ms = 240000) => page.waitForFunction((w) => document.querySelector('.edit-badge')?.innerText.includes(w), word, { timeout: ms });
    const now = () => page.evaluate(() => performance.now());
    /** Waits until no job is open for 600 ms after `t0`; returns the time to the last reply and the jobs posted. */
    const settled = async (t0) => {
      for (;;) {
        await page.waitForTimeout(150);
        const state = await page.evaluate((from) => {
          const jobs = window.__jobs.filter((job) => job.start >= from);
          const open = jobs.some((job) => job.end === undefined);
          const last = Math.max(from, ...jobs.map((job) => job.end ?? 0));
          return { open, last, now: performance.now(), jobs: jobs.map((job) => `${job.worker.replace('Worker', '')}:${job.kind}${job.end === -1 ? '(cut)' : ''}`) };
        }, t0);
        if (!state.open && state.jobs.length > 0 && state.now - state.last > 600) {
          const building = await page.evaluate(() => !!document.querySelector('footer .building') || !document.querySelector('.job-activity')?.hidden);
          if (!building) return { ms: Math.round(state.last - t0), jobs: state.jobs };
        }
      }
    };
    const measure = async (label, act) => {
      const samples = [];
      let jobs;
      for (let run = 0; run < RUNS; run += 1) {
        const t0 = await now();
        await act(run);
        const result = await settled(t0);
        samples.push(result.ms);
        jobs = result.jobs;
      }
      const row = { change: label, medianMs: median(samples), samplesMs: samples, jobsPerChange: jobs };
      console.log(JSON.stringify(row));
      return row;
    };

    await page.goto(url);
    await button('Aligner Support Production').click();
    await stepTo('Step 0');
    await page.locator('.dental-card').click();
    await stepTo('Step 1 · Aligner');
    await page.setInputFiles('input[aria-label="Choose aligner file"]', REFERENCE);
    await stepTo('Review the orientation');
    await button('Next').click();
    await stepTo('Step 2 · Support area');
    await page.waitForFunction(() => /Proposed support tips: [1-9]/.test(document.body.innerText), null, { timeout: 240000 });
    await settled(0);

    const rows = [];
    const tuning = (name) => page.locator('.dental-tuning label').filter({ hasText: name }).locator('input');
    rows.push(await measure('step2 Area width (one key press)', async (run) => {
      await tuning('Area width').focus();
      await tuning('Area width').press(run % 2 ? 'ArrowLeft' : 'ArrowRight');
    }));

    await button('Next').click();
    await stepTo('Step 3 · Supports');
    await page.waitForFunction(() => { const ok = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'OK'); return ok && !ok.disabled; }, null, { timeout: 300000 });
    await settled(0);

    const slider = (name) => page.locator('.dental-side label.tool-option').filter({ hasText: name }).locator('input');
    const press = (name) => async (run) => { await slider(name).focus(); await slider(name).press(run % 2 ? 'ArrowLeft' : 'ArrowRight'); };
    rows.push(await measure('step3 Tip size (one key press)', press('Tip size')));
    rows.push(await measure('step3 Lift height (one key press)', press('Lift height')));
    const raft = page.locator('.dental-side label.check').filter({ hasText: 'Raft' }).locator('input');
    rows.push(await measure('step3 Raft toggle', async () => { await raft.click(); }));
    console.log(JSON.stringify({ method: 'headless Chromium (swiftshader), vite dev server, reference aligner; change -> last worker reply with nothing in flight for 600 ms', runs: RUNS, rows }, null, 2));
  } finally {
    await browser?.close();
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
      else vite.kill('SIGKILL');
    } catch { /* gone */ }
  }
}

await main();
