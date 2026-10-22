// Browser walk: `npm run walk`. Starts Vite, drives headless Chromium through the editor on a fixture
// model, prints PASS/FAIL lines with numbers, exits 1 on any FAIL, and always stops Vite.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'knot.stl');
const VIEWPORT = { width: 1440, height: 900 };

/** Page script: the mesh worker's replies arrive `window.__meshDelay` ms late, so the first build can be pressed on while it runs. */
function slowMeshWorker() {
  const Real = window.Worker;
  window.__meshDelay = 0;
  window.Worker = class extends Real {
    constructor(url, options) {
      super(url, options);
      if (!String(url).includes('meshWorker')) return;
      this.addEventListener('message', (event) => {
        if (event.redelivered || !window.__meshDelay) return;
        event.stopImmediatePropagation();
        setTimeout(() => { const again = new MessageEvent('message', { data: event.data }); again.redelivered = true; this.dispatchEvent(again); }, window.__meshDelay);
      });
    }
  };
}
const FIRST_PORT = 5260;

/**
 * Numbers measured on `scripts/fixtures/knot.stl` at 1440x900 with the software GL below. They move
 * only when the support generator or the brush rules change on purpose; update them then.
 */
const BASE = {
  auto: 1167,
  dragSelected: [177, 272, 183],
  bottomSelected: 53,
  occlusion: [131, 602],
};

const results = [];
const started = Date.now();
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`);
}
const note = (text) => console.log(`     ${text}`);

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

function startVite(port) {
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  child.exited = new Promise((resolve) => child.once('exit', resolve));
  return child;
}

function stopVite(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

async function waitFor(url, child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error('Vite exited before it served');
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Vite did not serve in 60 s');
}

/** The newest Chromium that Playwright installed, when the one this playwright-core expects is missing. */
function installedChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright') : path.join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright'));
  if (!existsSync(base)) return undefined;
  const exe = process.platform === 'win32' ? 'chrome-win64/chrome.exe' : process.platform === 'darwin' ? 'chrome-mac/Chromium.app/Contents/MacOS/Chromium' : 'chrome-linux/chrome';
  return readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map((name) => path.join(base, name, exe)).find(existsSync);
}

async function launch() {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  // WALK_CHROMIUM names a browser to use; otherwise Playwright's own install is tried, then the newest one on disk.
  if (process.env.WALK_CHROMIUM) return chromium.launch({ headless: true, executablePath: process.env.WALK_CHROMIUM, args });
  try {
    return await chromium.launch({ headless: true, args });
  } catch (error) {
    const executablePath = installedChromium();
    if (!executablePath) {
      throw new Error(`No Chromium for Playwright. Run: npx playwright-core install chromium\n${error.message.split('\n')[0]}`);
    }
    return chromium.launch({ headless: true, executablePath, args });
  }
}

// ---- page helpers -----------------------------------------------------------------------------

/** Runs in the page: the React props of the viewport (selection, built support meshes) and of the scene owner. */
function readProps() {
  const root = document.getElementById('root');
  const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
  const stack = [root[key].stateNode?.current ?? root[key]];
  const out = {};
  while (stack.length) {
    const fiber = stack.pop();
    if (!fiber) continue;
    const p = fiber.memoizedProps;
    if (p && typeof p === 'object' && 'supportMeshes' in p) {
      if ('selection' in p) out.selection = [...p.selection].sort();
      if ('scene' in p) out.scene = p.scene;
      out.meshes = p.supportMeshes;
    }
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  const hash = (ids) => { let h = 2166136261; for (const ch of ids.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h.toString(16); };
  const mesh = out.meshes ? [...out.meshes.values()][0] : undefined;
  const unit = out.scene?.units?.[0];
  const drawn = mesh ? new Set(mesh.components.map((c) => c.contactId).filter(Boolean)) : new Set();
  return {
    selected: out.selection?.length ?? -1,
    hash: out.selection ? hash(out.selection) : '',
    tris: mesh ? mesh.indices.length / 3 : -1,
    drawn: drawn.size,
    dropped: mesh ? mesh.dropped.length : -1,
    droppedDrawn: mesh ? mesh.dropped.filter((id) => drawn.has(id)).length : -1,
    customised: unit ? Object.keys(unit.contactSettings).length : -1,
    point: unit?.settings?.pointDiameter,
    zones: unit ? unit.zones.length : -1,
    ids: out.selection ?? [],
  };
}

/** One Chromium page with the helpers the checks share. */
function makeDriver(page) {
  const idle = (ms) => page.evaluate((span) => new Promise((resolve) => setTimeout(resolve, span)), ms);
  const props = () => page.evaluate(readProps);
  const footer = () => page.evaluate(() => document.querySelector('footer')?.innerText ?? '');
  const status = () => page.evaluate(() => document.querySelector('footer strong')?.innerText ?? '');
  const counts = async () => {
    const match = (await footer()).match(/([\d,]+) automatic, ([\d,]+) manual, ([\d,]+) removed/);
    const n = (i) => (match ? Number(match[i].replace(/,/g, '')) : -1);
    return { auto: n(1), manual: n(2), removed: n(3) };
  };
  const quiet = () => page.waitForFunction(() => !!document.querySelector('.job-activity')?.hidden, null, { timeout: 300000 });
  /** Waits until the selection stops changing (a queued stroke drained). */
  const settle = async () => {
    let last = '';
    let same = 0;
    const t0 = Date.now();
    while (same < 5) {
      if (Date.now() - t0 > 180000) throw new Error('selection never settled');
      await idle(400);
      const p = await props();
      const s = `${p.selected}#${p.hash}`;
      same = s === last ? same + 1 : 0;
      last = s;
    }
    return props();
  };
  const settled = async () => { await idle(1000); await quiet(); await idle(400); };
  const button = (name, exact = true) => page.getByRole('button', { name, exact }).first();
  const editButton = () => page.locator('.panel.left .mode-button').locator('xpath=preceding-sibling::button[1]');
  const zonesButton = () => page.locator('aside.left h3', { hasText: /^Modes$/ }).locator('xpath=..').locator('button').nth(1);
  let box;
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  const stroke = async (from, to, moves, { button: which } = {}) => {
    await page.mouse.move(...at(...from));
    await idle(200);
    await page.mouse.down({ button: which ?? 'left' });
    for (let i = 0; i <= moves; i += 1) await page.mouse.move(...at(from[0] + (to[0] - from[0]) * i / moves, from[1] + (to[1] - from[1]) * i / moves));
    await page.mouse.up({ button: which ?? 'left' });
  };
  return {
    page, idle, props, footer, status, counts, quiet, settle, settled, button, editButton, zonesButton, stroke,
    async measureCanvas() { box = await page.locator('canvas').first().boundingBox(); },
    at,
    /** Generates the supports; with `whileBuilding`, presses Drag over in the window where the first build is still running. */
    async generate(url, whileBuilding) {
      await page.goto(url);
      await page.setInputFiles('.drop input[type=file]', FIXTURE);
      await page.waitForFunction(() => document.body.innerText.includes('knot'), null, { timeout: 60000 });
      if (whileBuilding) await page.evaluate(() => { window.__meshDelay = 8000; });
      await page.locator('.panel.left .primary').first().click();
      if (whileBuilding) {
        await this.measureCanvas();
        await page.waitForFunction(() => document.querySelector('footer .building'), null, { polling: 'raf', timeout: 240000 });
        const reached = await page.evaluate(async () => {
          const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const press = (name) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === name)?.click();
          document.querySelector('.panel.left .mode-button').previousElementSibling.click();
          await pause(150);
          press('Select supports');
          await pause(150);
          press('Drag over');
          await pause(250);
          return !!document.querySelector('footer .building');
        });
        await page.mouse.move(...this.at(0.5, 0.5));
        await page.mouse.down();
        await page.mouse.up();
        whileBuilding({ reached, status: await this.status(), building: await page.evaluate(() => !!document.querySelector('footer .building')) });
        await page.evaluate(() => { window.__meshDelay = 0; });
        await this.quiet();
        await this.idle(800);
        await this.exitMode();
      }
      await page.waitForFunction(() => /[1-9][\d,]* automatic/.test(document.querySelector('footer')?.innerText ?? '') && ![...document.querySelectorAll('button')].some((b) => /Generating/.test(b.innerText)), null, { timeout: 240000 });
      await quiet();
      await idle(800);
      await this.measureCanvas();
    },
    async enterDragOver(mode = 'Select supports') {
      await editButton().click();
      await button(mode).click();
      await button('Drag over').click();
      await button('Select').click();
      await idle(2500);
    },
    async exitMode() {
      await page.locator('.edit-done').click();
      await idle(600);
    },
  };
}

// ---- the walk ---------------------------------------------------------------------------------

/** Triangle count of an STL file, binary or ASCII. */
function stlTriangles(buffer) {
  if (buffer.length >= 84 && 84 + 50 * buffer.readUInt32LE(80) === buffer.length) return buffer.readUInt32LE(80);
  return (buffer.toString('latin1').match(/facet normal/g) ?? []).length;
}

async function exportSupports(d, dir) {
  const download = d.page.waitForEvent('download', { timeout: 600000 });
  await d.page.locator('.export button').nth(1).click();
  const file = path.join(dir, 'supports.stl');
  await (await download).saveAs(file);
  return stlTriangles(readFileSync(file));
}

/** The browser and Vite the run owns, so a signal or a throw anywhere still stops both. */
let browser;
let vite;

async function walk(url, scratch) {
  browser = await launch();
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  await context.addInitScript(() => { try { localStorage.setItem('mixo-supports.lang', 'en'); } catch { /* storage off */ } });
  await context.addInitScript(slowMeshWorker);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const d = makeDriver(page);
  try {
    let early;
    await d.generate(url, (seen) => { early = seen; });
    check('i Drag over pressed while the first build runs says so',
      early?.reached === true && early.building && early.status === 'Supports are still building.',
      `status "${early?.status}", build still running at the press ${early?.building}, mode reached while building ${early?.reached}`);

    // a. Generate and Drag over.
    const first = await d.counts();
    check('a1 generate: automatic count', first.auto === BASE.auto, `auto ${first.auto} (baseline ${BASE.auto}), manual ${first.manual}, removed ${first.removed}`);
    await d.enterDragOver();
    const strokes = [
      ['select, front', [[0.3, 0.5], [0.72, 0.5]], 30],
      ['select, upper part', [[0.32, 0.42], [0.7, 0.42]], 25],
    ];
    const picked = [];
    for (const [, [from, to], moves] of strokes) {
      await d.stroke(from, to, moves);
      picked.push((await d.settle()).selected);
    }
    await d.button('Unselect').click();
    await d.stroke([0.4, 0.45], [0.6, 0.55], 15);
    picked.push((await d.settle()).selected);
    check('a2 drag over: fixed selection counts', picked.join() === BASE.dragSelected.join(), `selected ${picked.join(', ')} (baseline ${BASE.dragSelected.join(', ')})`);
    await d.quiet();
    await page.keyboard.press('Delete');
    await d.settled();
    const deleted = await d.counts();
    check('a3 Delete removes exactly the selection', deleted.removed === picked.at(-1) && deleted.auto === first.auto - picked.at(-1), `removed ${deleted.removed} of ${picked.at(-1)} selected, auto ${deleted.auto}`);
    await page.keyboard.press('Control+z');
    await d.settled();
    const undone = await d.counts();
    check('a4 Undo brings them back', undone.removed === 0 && undone.auto === first.auto, `removed ${undone.removed}, auto ${undone.auto}`);
    await d.exitMode();

    // b. Occlusion.
    await d.enterDragOver();
    const front = [[0.33, 0.38], [0.7, 0.38]];
    await d.stroke(front[0], front[1], 30);
    const visible = (await d.settle()).selected;
    await d.button('Clear selection').click();
    await d.idle(500);
    await d.button('Hide models').click();
    await d.idle(800);
    await d.stroke(front[0], front[1], 30);
    const hiddenModel = (await d.settle()).selected;
    check('b occlusion: supports behind the model are skipped, and Hide models brings them back', visible === BASE.occlusion[0] && hiddenModel === BASE.occlusion[1] && visible < hiddenModel, `models shown ${visible}, models hidden ${hiddenModel} (baseline ${BASE.occlusion.join(', ')})`);
    await d.button('Clear selection').click();
    await d.button('Show models').click();
    await d.exitMode();

    // c. Zone landing, then d. export after zone + Delete.
    const beforeZone = await d.props();
    const countsBefore = await d.counts();
    await d.zonesButton().click();
    await d.idle(800);
    await d.idle(1500);
    for (const fy of [0.4, 0.46, 0.52, 0.58]) { await d.stroke([0.3, fy], [0.7, fy], 30); await d.idle(200); }
    await d.quiet();
    await page.waitForFunction(() => document.querySelector('.edit-badge b') && !/^0 /.test(document.querySelector('.edit-badge b').innerText), null, { timeout: 90000 }).catch(() => {});
    await d.settled();
    const zoned = await d.props();
    const countsZoned = await d.counts();
    check('c zone landing: the count and the drawn supports both lose the zoned ones',
      zoned.dropped > 0 && countsZoned.auto < countsBefore.auto && countsZoned.auto === zoned.drawn && zoned.droppedDrawn === 0,
      `auto ${countsBefore.auto} -> ${countsZoned.auto}, drawn supports ${beforeZone.drawn} -> ${zoned.drawn}, dropped by a landing ${zoned.dropped}, dropped still drawn ${zoned.droppedDrawn}`);
    await d.exitMode();

    await d.enterDragOver();
    await d.stroke([0.3, 0.5], [0.7, 0.5], 30);
    const forDelete = await d.settle();
    await page.keyboard.press('Delete');
    await d.settled();
    const afterDelete = await d.props();
    await d.exitMode();
    const exported = await exportSupports(d, scratch);
    check('d export after zone + Delete matches the build on screen', exported === afterDelete.tris, `exported ${exported} triangles, on screen ${afterDelete.tris} (deleted ${forDelete.selected}, drawn supports ${afterDelete.drawn})`);
    await page.keyboard.press('Control+z');
    await d.settled();
    const restored = await d.counts();
    check('d2 Undo after the export brings the deleted supports back', restored.removed === 0, `removed ${restored.removed}`);

    // e. Right-click remove, then add at the same spot; Undo and Redo.
    await d.editButton().click();
    await d.button('Add supports').click();
    await d.idle(2000);
    const base = await d.counts();
    let spot;
    search: for (const fy of [0.3, 0.35, 0.4, 0.45, 0.5]) {
      for (const fx of [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65]) {
        await page.mouse.move(...d.at(fx, fy));
        await d.idle(200);
        await page.mouse.click(...d.at(fx, fy), { button: 'right' });
        await d.idle(800);
        await d.quiet();
        if ((await d.counts()).removed === base.removed + 1) { spot = [fx, fy]; break search; }
      }
    }
    if (!spot) check('e right-click remove', false, 'no support found to remove');
    else {
      const step = async () => { await d.settled(); return d.counts(); };
      const removed = await d.counts();
      await page.mouse.click(...d.at(...spot));
      const added = await step();
      const keeps = added.manual === 1 && added.removed === removed.removed;
      await page.keyboard.press('Control+z');
      const undoAdd = await step();
      await page.keyboard.press('Control+z');
      const undoRemove = await step();
      await page.keyboard.press('Control+Shift+z');
      const redoRemove = await step();
      await page.keyboard.press('Control+Shift+z');
      const redoAdd = await step();
      check('e remove then add at the same spot keeps the manual support', keeps, `at ${spot}: removed ${removed.removed}, then manual ${added.manual} removed ${added.removed}`);
      check('e Undo and Redo walk both steps',
        undoAdd.manual === 0 && undoAdd.removed === removed.removed && undoRemove.removed === base.removed && redoRemove.removed === removed.removed && redoRemove.manual === 0 && redoAdd.manual === 1 && redoAdd.removed === removed.removed,
        `undo add ${undoAdd.manual}/${undoAdd.removed}, undo remove ${undoRemove.manual}/${undoRemove.removed}, redo remove ${redoRemove.manual}/${redoRemove.removed}, redo add ${redoAdd.manual}/${redoAdd.removed} (manual/removed)`);
    }
    await d.exitMode();

    // f. Per-support settings.
    const shape = page.locator('.panel.right section').filter({ has: page.locator('h3', { hasText: /Support shape/ }) });
    const pointField = () => shape.locator('label.field-row', { hasText: 'Point Ø' }).locator('input');
    const setPoint = async (value) => { await pointField().fill(value); await pointField().press('Enter'); await d.idle(2500); };
    await d.enterDragOver();
    await d.stroke([0.3, 0.5], [0.7, 0.5], 25);
    const chosen = await d.settle();
    const defaults = await d.props();
    await setPoint('0.6');
    const custom = await d.props();
    check('f1 Point Ø on the selection customises exactly those', custom.customised === chosen.selected && custom.point === defaults.point, `selected ${chosen.selected}, customised ${custom.customised}, object Point Ø ${custom.point}`);
    await d.button('Clear selection').click();
    await d.exitMode();
    await setPoint('0.35');
    const changed = await d.props();
    check('f2 changing the default leaves them customised', changed.customised === chosen.selected && changed.point === 0.35, `customised ${changed.customised}, default Point Ø ${changed.point}`);
    await page.locator('.shape-band button').click();
    await d.idle(1200);
    await d.settle();
    await shape.locator('.shape-head button').click();
    await d.idle(1500);
    const reset = await d.props();
    check('f3 Reset clears them', reset.customised === 0, `customised ${reset.customised}`);
    await page.keyboard.press('Control+z');
    await d.idle(1500);
    const unreset = await d.props();
    check('f4 Undo brings them back', unreset.customised === chosen.selected, `customised ${unreset.customised}`);
    await d.exitMode();

    // g. Select to Unselect mid-queue, under CPU throttle: the same result as the steps one after the other.
    await d.enterDragOver();
    const A = [[0.3, 0.5], [0.7, 0.5]];
    const B = [[0.45, 0.4], [0.55, 0.6]];
    await d.stroke(A[0], A[1], 30);
    await d.settle();
    await d.button('Unselect').click();
    await d.stroke(B[0], B[1], 15);
    const sequential = await d.settle();
    await d.button('Clear selection').click();
    await d.button('Select', true).click().catch(() => {});
    await d.idle(500);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await d.stroke(A[0], A[1], 30);
    const pendingAtSwitch = (await d.props()).selected;
    await d.button('Unselect').click();
    await d.stroke(B[0], B[1], 15);
    const switched = await d.settle();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    check('g Select to Unselect mid-queue keeps the earlier steps as Select', switched.hash === sequential.hash, `one after the other ${sequential.selected} (#${sequential.hash}), switched mid-queue ${switched.selected} (#${switched.hash}), selected when switching ${pendingAtSwitch}`);
    await d.exitMode();

    // a5. Drag over from Bottom view (the camera stays there, so it runs last).
    await d.enterDragOver();
    await d.button('Clear selection').click().catch(() => {});
    await d.button('Bottom view').click();
    await d.idle(1500);
    await d.stroke([0.3, 0.5], [0.7, 0.5], 25);
    const fromBelow = await d.settle();
    check('a5 drag over from Bottom view: fixed selection count', fromBelow.selected === BASE.bottomSelected, `selected ${fromBelow.selected} (baseline ${BASE.bottomSelected})`);
    await d.exitMode();

    // i. Save project, reload, Open it: the same work comes back; Open over objects is one Undo.
    await d.enterDragOver();
    await d.stroke([0.3, 0.5], [0.7, 0.5], 25);
    await d.settle();
    await page.keyboard.press('Delete');
    await d.settled();
    await d.exitMode();
    const projectStats = async () => ({ ...(await d.counts()), customised: (await d.props()).customised, zones: (await d.props()).zones });
    const leavePrompt = () => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    const before = await projectStats();
    check('i1 the work to save has every kind of hand edit', before.manual > 0 && before.removed > 0 && before.customised > 0 && before.zones > 0, JSON.stringify(before));
    const unsaved = await leavePrompt();
    const download = page.waitForEvent('download', { timeout: 120000 });
    await d.button('Save project').click();
    const projectFile = path.join(scratch, 'knot.mixosupports');
    const saved = await download;
    await saved.saveAs(projectFile);
    await d.settled();
    const bytes = readFileSync(projectFile);
    const raw = gunzipSync(bytes);
    note(`project file ${saved.suggestedFilename()}: ${bytes.length} bytes gzip, ${raw.length} bytes plain`);
    const header = JSON.parse(raw.toString('utf8').slice(0, 200).replace(/,"scene".*$/s, '}'));
    check('i2 Save writes knot.mixosupports with the format header, and the leave prompt follows it',
      saved.suggestedFilename() === 'knot.mixosupports' && header.app === 'mixo-supports' && header.version === 1 && unsaved === true && (await leavePrompt()) === false && (await d.status()) === 'Saved knot.mixosupports.',
      `file ${saved.suggestedFilename()}, header ${JSON.stringify(header)}, prompt before the save ${unsaved}, status "${await d.status()}"`);

    await page.goto(url);
    await d.idle(1500);
    await page.evaluate(() => {
      window.__longTasks = [];
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); }).observe({ type: 'longtask', buffered: false });
    });
    const chooser = page.waitForEvent('filechooser');
    await d.button('Open project').click();
    await (await chooser).setFiles(projectFile);
    await page.waitForFunction(() => /[1-9][\d,]* automatic/.test(document.querySelector('footer')?.innerText ?? ''), null, { timeout: 120000 });
    await d.settled();
    note(`Open project main-thread long tasks (ms): ${JSON.stringify(await page.evaluate(() => window.__longTasks))}`);
    const after = await projectStats();
    check('i3 Open after a reload: automatic, manual, removed, customised and zones are identical', JSON.stringify(after) === JSON.stringify(before), `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
    check('i4 a freshly opened project has nothing unsaved', (await leavePrompt()) === false && (await d.status()) === 'Opened knot.mixosupports.', `status "${await d.status()}"`);

    await page.goto(url);
    await page.setInputFiles('.drop input[type=file]', FIXTURE);
    await page.waitForFunction(() => document.body.innerText.includes('knot'), null, { timeout: 60000 });
    await d.settled();
    const chooser2 = page.waitForEvent('filechooser');
    await d.button('Open project').click();
    await (await chooser2).setFiles(projectFile);
    await page.waitForFunction(() => document.querySelector('.undo-toast'), null, { timeout: 120000 });
    await d.settled();
    const over = await projectStats();
    await page.locator('.undo-toast button').click();
    await d.settled();
    const undoneOpen = await projectStats();
    check('i5 Open over an object offers Undo, and Undo restores the plate as it was',
      over.auto === before.auto && undoneOpen.auto === 0 && undoneOpen.manual === 0 && undoneOpen.zones === 0 && (await page.locator('footer').innerText()).includes('1 object'),
      `opened ${JSON.stringify(over)}, after Undo ${JSON.stringify(undoneOpen)}`);

    const wrong = path.join(scratch, 'wrong.mixosupports');
    writeFileSync(wrong, JSON.stringify({ app: 'mixo-supports', version: 99, scene: { units: [], selectedUnitIds: [] } }));
    const chooser3 = page.waitForEvent('filechooser');
    await d.button('Open project').click();
    await (await chooser3).setFiles(wrong);
    await d.idle(1000);
    check('i6 a newer file is refused with a message and the plate stays', /newer version/.test(await d.status()) && (await page.locator('footer').innerText()).includes('1 object'), `status "${await d.status()}"`);
  } catch (error) {
    check('walk ran to the end', false, error.message);
    await page.screenshot({ path: path.join(scratch, 'walk-error.png') }).catch(() => {});
    note(`screenshot ${path.join(scratch, 'walk-error.png')}`);
  }
  check('h no console errors or warnings', errors.length === 0, errors.length ? errors.slice(0, 3).join(' || ') : '0 messages');
}

// WALK_OUT: where a failing run leaves its screenshots and files (CI uploads it); a passing run removes them.
const scratch = process.env.WALK_OUT ? (mkdirSync(path.resolve(process.env.WALK_OUT), { recursive: true }), mkdtempSync(path.join(path.resolve(process.env.WALK_OUT), 'run-'))) : mkdtempSync(path.join(tmpdir(), 'mixo-walk-'));
async function stopAll() {
  await browser?.close().catch(() => {});
  stopVite(vite);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopAll().finally(() => process.exit(130)); });
}
try {
  const port = await freePort(FIRST_PORT);
  vite = startVite(port);
  const url = `http://127.0.0.1:${port}/mixo-supports/`;
  await waitFor(url, vite);
  console.log(`walk on ${url}`);
  await walk(url, scratch);
} catch (error) {
  check('walk setup', false, error.message);
} finally {
  await stopAll();
}
const failed = results.filter((r) => !r.ok).length;
if (failed === 0) rmSync(scratch, { recursive: true, force: true });
console.log(`${failed === 0 ? 'ALL PASS' : `${failed} FAIL`} (${results.length} checks, ${Math.round((Date.now() - started) / 1000)} s)`);
process.exit(failed === 0 ? 0 : 1);
