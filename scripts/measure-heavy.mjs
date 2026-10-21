// Heavy-mesh browser measurements (shared heavy-mesh spec §6), for the budget numbers.
//
//   node scripts/measure-heavy.mjs [--files heavy-2m.stl,heavy-5m.stl] [--runtime web|desktop] [--port 5202]
//
// Needs the fixtures from `npx vite-node scripts/make-heavy-meshes.ts` in .playwright-mcp/heavy/ and a
// Playwright Chromium (or CHROME=path). Per fixture: starts a fresh Chrome (own profile, real GPU),
// opens the app from a Vite dev server, imports the file through the real file input
// (DOM.setFileInputFiles, so the page gets a disk-backed File), presses Generate, and records:
//   importMs        file set → import finished (status line), or the refusal
//   maxBlockMs      longest main-thread long task during import (UI freeze)
//   generateMs      Generate → contacts placed and the preview supports built
//   peakRendererMB  peak private bytes of the page's renderer process (page + its workers)
//   peakGpuMB       peak private bytes of the GPU process
//   heapMB          JS heap after generating (performance.memory, precise)
// Every process it starts is stopped at the end.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', '5202'));
const RUNTIME = arg('runtime', 'web');
const FILES = arg('files', 'heavy-2m.stl,heavy-5m.stl,heavy-10m.stl').split(',');
const SHOTS = arg('shots', '');
const DEBUG_PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const builds = existsSync(base) ? readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort() : [];
  for (const build of builds.reverse()) {
    const exe = join(base, build, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  throw new Error('No Chromium found: set CHROME to a chrome.exe');
}

async function waitHttp(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${url}`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.crashed = false;
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Inspector.targetCrashed') {
        this.crashed = true;
        for (const waiter of this.pending.values()) waiter.reject(new Error('renderer crashed'));
        this.pending.clear();
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
    };
    this.socket.onclose = () => {
      this.crashed = true;
      for (const waiter of this.pending.values()) waiter.reject(new Error('page connection closed (renderer crashed?)'));
      this.pending.clear();
    };
    this.ready = new Promise((done, fail) => { this.socket.onopen = done; this.socket.onerror = fail; });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCall, reject) => this.pending.set(id, { resolve: resolveCall, reject }));
  }
  async evaluate(expression, timeoutMs = 60_000) {
    const call = this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const late = new Promise((_, reject) => setTimeout(() => reject(new Error(`page unresponsive for ${timeoutMs / 1000} s`)), timeoutMs));
    const { result, exceptionDetails } = await Promise.race([call, late]);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
  close() { this.socket.close(); }
}

/** Private bytes of the given processes, sampled every 100 ms by one PowerShell loop. */
function startSampler(pids) {
  const script = `$ids=@(${pids.join(',')}); while($true){ foreach($i in $ids){ $p=Get-Process -Id $i -ErrorAction SilentlyContinue; if($p){ [Console]::Out.WriteLine("$i $($p.PrivateMemorySize64)") } }; [Console]::Out.Flush(); Start-Sleep -Milliseconds 100 }`;
  const child = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const peak = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const [pid, bytes] = buffer.slice(0, newline).trim().split(' ').map(Number);
      buffer = buffer.slice(newline + 1);
      if (pid && Number.isFinite(bytes)) peak.set(pid, Math.max(peak.get(pid) ?? 0, bytes));
    }
  });
  return { child, peakMB: (pid) => Math.round((peak.get(pid) ?? 0) / 2 ** 20) };
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
}

const STATUS = 'document.querySelector("footer strong")?.textContent ?? ""';
const DONE_IMPORT = /Imported|heavy model|large model|plate now holds|build handles up to|more memory|Import error|Import (took|stopped)/;

async function measure(chromePath, file) {
  const profile = mkdtempSync(join(tmpdir(), 'mixo-heavy-'));
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--enable-precise-memory-info',
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', '--use-angle=d3d11', 'about:blank',
  ], { stdio: 'ignore' });
  let sampler;
  let page;
  try {
    const version = await (await waitHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    const browser = new Cdp(version.webSocketDebuggerUrl);
    await browser.ready;
    const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?http://localhost:${PORT}/mixo-supports/`, { method: 'PUT' })).json();
    page = new Cdp(target.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Runtime.enable');
    await page.send('Inspector.enable');
    await page.send('DOM.enable');
    for (let i = 0; i < 100 && !(await page.evaluate('!!document.querySelector("input[type=file]")')); i += 1) await sleep(200);
    let renderers = [];
    let gpu;
    for (let i = 0; i < 50 && renderers.length === 0; i += 1) {
      const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
      renderers = processInfo.filter((process) => process.type === 'renderer').map((process) => process.id);
      gpu = processInfo.find((process) => process.type === 'GPU')?.id;
      if (renderers.length === 0) await sleep(200);
    }
    sampler = startSampler([...renderers, ...(gpu ? [gpu] : [])]);
    await page.evaluate(`window.__longest = 0; new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longest = Math.max(window.__longest, entry.duration); }).observe({ type: 'longtask', buffered: false }); true`);
    // The dev server may reload the page once (dependency optimisation): look the input up again then.
    let started = 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const { root } = await page.send('DOM.getDocument');
        const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
        started = Date.now();
        await page.send('DOM.setFileInputFiles', { nodeId, files: [join(ROOT, '.playwright-mcp', 'heavy', file)] });
        break;
      } catch (error) {
        if (attempt >= 5) throw error;
        await sleep(1000);
      }
    }
    // --shots DIR: screenshots of the activity list while importing and generating, and of the result.
    const shot = async (name) => {
      if (!SHOTS) return;
      mkdirSync(SHOTS, { recursive: true });
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, `${file.replace(/\.stl$/, '')}-${name}.png`), Buffer.from(data, 'base64'));
    };
    let status = '';
    let shotImport = false;
    while (!DONE_IMPORT.test(status) && Date.now() - started < 600_000) {
      await sleep(100);
      status = await page.evaluate(STATUS);
      if (!shotImport && await page.evaluate('document.querySelector(".job-activity")?.hidden === false')) {
        shotImport = true;
        await shot('importing');
      }
    }
    await shot('imported');
    const importMs = Date.now() - started;
    const maxBlockMs = Math.round(await page.evaluate('window.__longest'));
    const result = { file, runtime: RUNTIME, importMs, maxBlockMs, importStatus: status };
    if (/Imported|heavy model|large model|plate now holds/.test(status)) {
      await sleep(1500); // first frames, deferred work
      const generateStart = Date.now();
      await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Generate supports' && !b.disabled).click(); true`);
      let placed = false;
      let idle = false;
      let lastJobs = '';
      let shotGenerate = false;
      try {
        while (!(placed && idle) && Date.now() - generateStart < 900_000) {
          await sleep(500);
          status = await page.evaluate(STATUS);
          lastJobs = (await page.evaluate('document.querySelector(".job-activity")?.textContent ?? ""')) || lastJobs;
          if (process.env.TRACE && (Date.now() - generateStart) % 10_000 < 500) console.error(`${Math.round((Date.now() - generateStart) / 1000)} s ${Math.max(0, ...renderers.map((pid) => sampler.peakMB(pid)))} MB: ${lastJobs}`);
          placed ||= /automatic contacts generated|analysis failed|failed/.test(status);
          idle = placed && await page.evaluate('document.querySelector(".job-activity")?.hidden !== false');
          if (!shotGenerate && Date.now() - generateStart > 3000) {
            shotGenerate = true;
            await shot('generating');
          }
        }
        await shot('generated');
        result.generateMs = Date.now() - generateStart;
        result.generateStatus = status;
        result.heapMB = Math.round((await page.evaluate('performance.memory.usedJSHeapSize')) / 2 ** 20);
      } catch (error) {
        result.generateMs = Date.now() - generateStart;
        result.generateStatus = `${error.message} (last job shown: ${lastJobs})`;
      }
      if (!(placed && idle) && result.generateStatus === status) result.generateStatus = `stalled after ${result.generateMs} ms: ${status} / ${lastJobs}`;
    }
    await sleep(300);
    result.peakRendererMB = Math.max(...renderers.map((pid) => sampler.peakMB(pid)));
    result.peakGpuMB = gpu ? sampler.peakMB(gpu) : null;
    browser.close();
    return result;
  } finally {
    page?.close();
    if (sampler) stop(sampler.child);
    stop(chrome);
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked; temp */ }
  }
}

const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: 'ignore', env: { ...process.env, ...(RUNTIME === 'desktop' ? { VITE_RUNTIME: 'desktop' } : {}) },
});
try {
  await waitHttp(`http://localhost:${PORT}/mixo-supports/`);
  const chromePath = findChrome();
  for (const file of FILES) console.log(JSON.stringify(await measure(chromePath, file)));
} finally {
  stop(vite);
}
