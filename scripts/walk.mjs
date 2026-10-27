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

/** ASCII STL text of an indexed mesh (the walk's synthetic aligner stand-ins). */
function asciiStl(name, positions, indices) {
  const lines = [`solid ${name}`];
  for (let at = 0; at < indices.length; at += 3) {
    lines.push('facet normal 0 0 0', 'outer loop');
    for (let k = 0; k < 3; k += 1) lines.push(`vertex ${[0, 1, 2].map((axis) => positions[indices[at + k] * 3 + axis]).join(' ')}`);
    lines.push('endloop', 'endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}
/** A closed unit cube: no cavity, so orientation fails. */
function cubeStl() {
  const p = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  const i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return asciiStl('cube', p, i);
}
/** A closed, manifold thick cup: it has a cavity opening but no central opening, so a type that insists on one is offered a switch. */
function cupStl() {
  const segments = 16;
  const positions = [0, -2, 0, 0, -4, 0];
  // Rings: outer bottom, outer top, inner top, inner bottom.
  for (const [radius, y] of [[10, -4], [10, 4], [8, 4], [8, -2]]) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment * Math.PI * 2 / segments;
      positions.push(radius * Math.cos(angle), y, radius * Math.sin(angle));
    }
  }
  const at = (ring, segment) => 2 + ring * segments + ((segment + segments) % segments);
  const indices = [];
  const quad = (a, b, c, e) => indices.push(a, b, c, a, c, e);
  for (let segment = 0; segment < segments; segment += 1) {
    const next = segment + 1;
    quad(at(0, segment), at(0, next), at(1, next), at(1, segment));
    quad(at(1, segment), at(1, next), at(2, next), at(2, segment));
    quad(at(2, segment), at(2, next), at(3, next), at(3, segment));
    indices.push(0, at(3, segment), at(3, next));
    indices.push(1, at(0, next), at(0, segment));
  }
  return asciiStl('cup', positions, indices);
}


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
  const active = out.scene?.units?.find((candidate) => candidate.id === out.scene.activeUnitId);
  const drawn = mesh ? new Set(mesh.components.map((c) => c.contactId).filter(Boolean)) : new Set();
  return {
    selected: out.selection?.length ?? -1,
    hash: out.selection ? hash(out.selection) : '',
    tris: mesh ? mesh.indices.length / 3 : -1,
    drawn: drawn.size,
    dropped: mesh ? mesh.dropped.length : -1,
    droppedDrawn: mesh ? mesh.dropped.filter((id) => drawn.has(id)).length : -1,
    islands: mesh?.islands ? (mesh.islands.status === 'ok' ? { resolved: mesh.islands.islands.filter((i) => i.status === 'resolved').length, unresolved: mesh.islands.islands.filter((i) => i.status === 'unresolved').length, manualOnly: mesh.islands.islands.filter((i) => i.status === 'manual-only').length } : 'inconclusive') : undefined,
    dentalReviewGap: mesh?.dentalRimCoverage?.opening.reviewGapMm ?? -1,
    customised: unit ? Object.keys(unit.contactSettings).length : -1,
    active: out.scene?.activeUnitId,
    first: unit?.id,
    point: unit?.settings?.pointDiameter,
    zones: unit ? unit.zones.length : -1,
    dentalBoundary: unit?.dental?.rim.boundaryKind ?? '',
    dentalKind: unit?.dental?.kind ?? '',
    activeDental: active?.dental ? { kind: active.dental.kind ?? 'legacy', origin: active.dental.origin ?? '', stamps: active.dental.stamps.length } : undefined,
    dentalStamps: unit?.dental?.stamps.length ?? -1,
    dentalFaces: unit?.dental?.kind === 'two-contour' ? unit.dental.region.contactFaces?.reduce((sum, face) => sum + face, 0) ?? -1 : -1,
    dentalContacts: unit?.dental?.kind === 'two-contour' ? unit.dental.region.contacts?.length ?? -1 : -1,
    dentalTuning: unit?.dental?.kind === 'two-contour' ? unit.dental.tuning : undefined,
    ids: out.selection ?? [],
    units: (out.scene?.units ?? []).map((u) => ({ id: u.id, label: u.settings?.labelText ?? '', supports: Boolean(u.supports), dental: Boolean(u.dental), pos: [...u.transform.position], manual: u.manual.length, deleted: u.deleted.length })),
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

/** Every vertex x of a binary STL (the whole-plate export), for the arrangement checks. */
function stlVertexXs(buffer) {
  const count = buffer.readUInt32LE(80);
  const xs = [];
  for (let at = 0; at < count; at += 1) for (let k = 0; k < 3; k += 1) xs.push(buffer.readFloatLE(84 + at * 50 + 12 + k * 12));
  return { count, xs };
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

async function walk(url, scratch, dentalFixture) {
  browser = await launch();
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  await context.addInitScript(() => { try { localStorage.setItem('mixo-supports.lang', 'en'); } catch { /* storage off */ } });
  await context.addInitScript(slowMeshWorker);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const outside = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') outside.push(r.url());
  });
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

    // k. Select them from another object: the active object has none, the first selected object with customised supports takes over.
    await page.setInputFiles('.drop input[type=file]', FIXTURE);
    await page.waitForFunction(() => document.querySelector('footer')?.innerText.includes('2 objects'), null, { timeout: 60000 });
    await d.settled();
    await d.button('Select all').click();
    await d.idle(500);
    const beforeSelectThem = await d.props();
    await page.locator('.shape-band button').click();
    await d.idle(1500);
    const afterSelectThem = await d.props();
    const selectStatus = await d.status();
    check('k Select them with the active object bare switches to the first object with customised supports',
      beforeSelectThem.active !== beforeSelectThem.first && afterSelectThem.active === afterSelectThem.first && afterSelectThem.selected === chosen.selected && new RegExp(`^${chosen.selected} customised supports selected on .+\.$`).test(selectStatus),
      `active was ${beforeSelectThem.active === beforeSelectThem.first ? 'first' : 'second'}, now ${afterSelectThem.active === afterSelectThem.first ? 'first' : 'second'}, selected ${afterSelectThem.selected} of ${chosen.selected}, status "${selectStatus}"`);
    await d.exitMode();
    for (let step = 0; step < 8 && !(await d.footer()).includes('1 object'); step += 1) {
      await page.keyboard.press('Control+z');
      await d.idle(700);
    }
    check('k2 Undo takes the second object away again', (await d.footer()).includes('1 object') && (await d.props()).customised === chosen.selected, `footer ${(await d.footer()).includes('1 object') ? '1 object' : 'more objects'}, customised ${(await d.props()).customised}`);

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
    // The toast counts down 6 s; hold it with the pointer while the plate settles (a slow machine outlasts it).
    await page.locator('.undo-toast').hover();
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


    // u. Dental flow, Step 0 to Step 2 (the repo's reference aligner; synthetic files for the failure branches).
    {
      const reference = path.join(ROOT, 'docs', 'dental-reference', 'reference-aligner.stl');
      const cube = path.join(scratch, 'cube.stl');
      const cup = path.join(scratch, 'cup.stl');
      const badStl = path.join(scratch, 'broken.stl');
      const notModel = path.join(scratch, 'notes.txt');
      const holed = path.join(scratch, 'holed.stl');
      writeFileSync(cube, cubeStl());
      writeFileSync(cup, cupStl());
      writeFileSync(badStl, 'solid x\nthis is not a mesh\n');
      writeFileSync(notModel, 'not a model');
      const whole = readFileSync(reference);
      // Binary STL (84-byte head, 50 bytes a triangle): the last 40 triangles cut off leaves a hole.
      const count = whole.readUInt32LE(80);
      const cut = Buffer.from(whole.subarray(0, 84 + (count - 40) * 50));
      cut.writeUInt32LE(count - 40, 80);
      writeFileSync(holed, cut);
      const drop = (file) => page.setInputFiles('input[aria-label="Choose aligner file"]', file);
      const badge = () => page.locator('.edit-badge').innerText();
      const objects = async () => (await page.locator('footer').innerText()).match(/(\d+) objects?/)?.[1];
      const stepTo = async (text, ms = 20000) => page.waitForFunction((word) => document.querySelector('.edit-badge')?.innerText.includes(word), text, { timeout: ms });
      const noticeShown = (text) => page.waitForFunction((word) => [...document.querySelectorAll('[role="alert"]')].some((node) => node.innerText.includes(word)), text, { timeout: 120000 });

      await page.goto(url);
      await d.button('Aligner Support Production').click();
      await stepTo('Step 0 · Aligner type');
      const inertLeft = await page.locator('.panel.left [inert]').count();
      const inertRight = await page.locator('.panel.right [inert]').count();
      check('u0 entering the dental flow dims both side panels and shows the type card', inertLeft >= 3 && inertRight >= 2 && await page.locator('.dental-card').count() === 1 && /Reference aligner/.test(await page.locator('.dental-card').innerText()) && await page.locator('.dental-card svg').count() === 1,
        `inert left ${inertLeft}, right ${inertRight}, cards ${await page.locator('.dental-card').count()}`);
      await page.screenshot({ path: path.join(scratch, 'ux-a-step0.png') });
      await d.button('Exit').click();
      await page.waitForFunction(() => !document.querySelector('.edit-badge'), null, { timeout: 5000 });
      check('u1 Exit at Step 0 leaves the flow with the plate untouched', (await objects()) === '0' && (await page.locator('.panel.left [inert]').count()) === 0, `objects ${await objects()}`);

      await d.button('Aligner Support Production').click();
      await page.locator('.dental-card').click();
      await stepTo('Step 1 · Aligner');
      check('u2 one click on the card goes to Step 1, which asks for the aligner file', await page.getByText('Drop the aligner STL here').isVisible() && await d.button('Back').isVisible());
      await page.screenshot({ path: path.join(scratch, 'ux-a-step1-drop.png') });

      await drop(notModel);
      await noticeShown('STL');
      check('u3 a file that is no model is refused in place, Step 1 stays', (await badge()).includes('Step 1 · Aligner') && await page.getByText('Drop the aligner STL here').isVisible() && (await objects()) === '0', `status "${await d.status()}"`);
      await drop(badStl);
      await noticeShown('');
      await d.idle(1500);
      check('u4 a broken STL is refused in place, Step 1 stays, nothing is added', (await badge()).includes('Step 1 · Aligner') && await page.getByText('Drop the aligner STL here').isVisible() && (await objects()) === '0', `status "${await d.status()}", objects ${await objects()}`);

      await drop(cube);
      await noticeShown('could not be oriented automatically');
      check('u5 failed orientation says so, keeps the dropped pose, and Back, Exit and Next stay available',
        await d.button('Next').isEnabled() && await d.button('Back').isVisible() && await d.button('Exit').isVisible() && (await badge()).includes('Step 1 · Aligner'));
      await d.button('Next').click();
      await page.waitForFunction(() => /No aligner opening was found/.test(document.querySelector('footer strong')?.innerText ?? ''), null, { timeout: 10000 });
      check('u5b Next without a detected opening explains itself and stays in Step 1', (await badge()).includes('Step 1 · Aligner'), `status "${await d.status()}"`);
      await d.button('Back').click();
      await stepTo('Step 0');
      await page.locator('.dental-card').click();
      await stepTo('Step 1 · Aligner');

      await drop(holed);
      await noticeShown('holes or non-manifold');
      check('u6 a mesh with holes is warned about before detection is trusted', await page.getByText('holes or non-manifold').isVisible());
      await d.button('Back').click();
      await stepTo('Step 0');
      await page.locator('.dental-card').click();
      await stepTo('Step 1 · Aligner');
      await drop(cup);
      await noticeShown('different aligner type');
      check('u7 a model with no central opening offers a type switch or Keep instead of silently continuing', await page.getByRole('button', { name: /^Keep / }).isVisible());
      await page.getByRole('button', { name: /^Keep / }).click();
      check('u7b Keep dismisses the type prompt', (await page.getByText('different aligner type').count()) === 0);
      await d.button('Next').click();
      await stepTo('Step 2 · Support area', 120000);
      check('u8 no detected area: Step 2 opens with its message and Next stays off',
        await page.getByText('No support area was detected').first().isVisible() && await d.button('Next').isDisabled(), `status "${await d.status()}"`);
      const unpainted = (await d.props()).activeDental;
      check('u8b no detected area: paint starts from an empty manual-area policy, not from the cavity footprint', unpainted?.kind === 'legacy' && unpainted.origin === 'manual-area' && unpainted.stamps === 0, `policy ${JSON.stringify(unpainted)}`);
      await d.button('Back').click();
      await stepTo('Step 1 · Aligner');
      await d.button('Back').click();
      await stepTo('Step 0');

      await page.locator('.dental-card').click();
      await stepTo('Step 1 · Aligner');
      const dropped = Date.now();
      await drop(reference);
      await stepTo('Review the orientation', 180000);
      note(`reference aligner read and oriented in ${Math.round((Date.now() - dropped) / 1000)} s`);
      check('u9 the dropped aligner is oriented with no button pressed, and the mesh check is clean', (await page.getByText('holes or non-manifold').count()) === 0 && (await page.getByText('could not be oriented').count()) === 0 && await d.button('Next').isEnabled());
      await d.button('Next').click();
      await stepTo('Step 2 · Support area', 180000);
      await page.waitForFunction(() => [...document.querySelectorAll('.edit-note')].some((note) => /Proposed support tips: [1-9]/.test(note.innerText)), null, { timeout: 240000 });
      check('u10 Step 2 shows the detected area with tips, and Next is on', await d.button('Next').isEnabled() && (await page.getByText('No support area was detected').count()) === 0);
      await page.screenshot({ path: path.join(scratch, 'ux-a-step2.png') });
      await d.button('Back').click();
      await stepTo('Step 1 · Aligner');
      check('u11 Back from Step 2 returns to Step 1 with the oriented aligner kept', await d.button('Next').isEnabled() && (await page.getByText('Drop the aligner STL here').count()) === 0);
      await d.button('Exit').click();
      await page.waitForFunction(() => !document.querySelector('.edit-badge'), null, { timeout: 5000 });
      const left = await d.counts();
      check('u12 Exit leaves the aligners on the plate without supports', (await page.locator('.panel.left [inert]').count()) === 0 && Number(await objects()) >= 1 && left.auto === 0, `objects ${await objects()}, automatic supports ${left.auto}`);
    }

    // x. Dental flow, Step 3 and finish: two aligners end to end (the repo's reference aligner twice).
    {
      const reference = path.join(ROOT, 'docs', 'dental-reference', 'reference-aligner.stl');
      const drop = (file) => page.setInputFiles('input[aria-label="Choose aligner file"]', file);
      const stepTo = async (text, ms = 20000) => page.waitForFunction((word) => document.querySelector('.edit-badge')?.innerText.includes(word), text, { timeout: ms });
      const objects = async () => (await page.locator('footer').innerText()).match(/(\d+) objects?/)?.[1];
      const label = page.locator('.dental-side input.dental-label');
      const slider = (name) => page.locator('.dental-side label.tool-option').filter({ hasText: name }).locator('input');
      /** One aligner from the type card (first) or Step 1 to Step 3, supports built. */
      const toStep3 = async (first) => {
        if (first) {
          await page.goto(url);
          await d.button('Aligner Support Production').click();
          await stepTo('Step 0 · Aligner type');
          await page.locator('.dental-card').click();
        }
        await stepTo('Step 1 · Aligner');
        await drop(reference);
        await stepTo('Review the orientation', 180000);
        await d.button('Next').click();
        await stepTo('Step 2 · Support area', 180000);
        await page.waitForFunction(() => [...document.querySelectorAll('.edit-note')].some((note) => /Proposed support tips: [1-9]/.test(note.innerText)), null, { timeout: 240000 });
        if (first) check('x0 Step 2 no longer carries the Tree and Brace toggles', (await page.getByText('Tree branches').count()) === 0 && (await page.getByText('Cross-braces').count()) === 0);
        await d.button('Next').click();
        await stepTo('Step 3 · Supports', 240000);
        await page.waitForFunction(() => { const ok = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'OK'); return ok && !ok.disabled; }, null, { timeout: 300000 });
        await d.quiet();
      };
      const wait = async (ok, what, ms = 240000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ok()) return true; await d.idle(300); } throw new Error(`timed out: ${what}`); };

      await toStep3(true);
      await d.measureCanvas();
      await page.screenshot({ path: path.join(scratch, 'ux-c-step3-1440x900.png') });
      // The finish controls stay in view without scrolling, at the walk size and at 1280x720.
      const finishInView = () => page.evaluate(() => {
        const side = document.querySelector('.dental-side');
        const names = ['Back', 'Exit', 'OK', 'Add another aligner'];
        const boxes = names.map((name) => [...side.querySelectorAll('button')].find((b) => b.innerText.trim() === name)?.getBoundingClientRect());
        const label = side.querySelector('input.dental-label')?.getBoundingClientRect();
        return [...boxes, label].every((r) => r && r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0);
      });
      const at1440 = await finishInView();
      await page.setViewportSize({ width: 1280, height: 720 });
      await d.idle(600);
      await page.getByRole('button', { name: 'Fit view', exact: true }).click({ timeout: 5000 });
      await d.idle(1200);
      await page.screenshot({ path: path.join(scratch, 'ux-c-step3-1280x720.png') });
      const at1280 = await finishInView();
      await page.setViewportSize(VIEWPORT);
      await d.idle(600);
      await d.measureCanvas();
      check('x1b Step 3 finish controls (Label, Back, Exit, OK, Add another aligner) are in view without scrolling at 1440x900 and 1280x720', at1440 && at1280, `1440x900 ${at1440}, 1280x720 ${at1280}`);
      const side = await page.locator('.dental-side').innerText();
      check('x1 Step 3 lists tip size, density, lift height, raft, Tree, Brace, the support tools, problems, Label, OK and Add another aligner',
        ['Tip size', 'Support density', 'Lift height', 'Raft', 'Tree branches', 'Cross-braces', 'Add supports', 'Problems', 'Label', 'OK', 'Add another aligner'].every((word) => side.includes(word)), side.replace(/\s+/g, ' ').slice(0, 200));
      check('x2 the Label field is titled Label and starts as X', (await label.inputValue()) === 'X' && (await page.getByLabel('Label', { exact: true }).count()) >= 1, `value "${await label.inputValue()}"`);
      await label.fill('');
      await label.pressSequentially('a-1b_$%é .');
      const typed = await label.inputValue();
      await label.fill('abcdefghijkl');
      const capped = await label.inputValue();
      check('x3 the Label field takes only A-Z 0-9 and -, uppercases letters, and stops at 8 characters', typed === 'A-1B' && capped === 'ABCDEFGH', `typed "${typed}", long "${capped}"`);
      await label.fill('L-1');
      await d.idle(500);
      check('x4 the typed label is stored with the aligner', (await d.props()).units[0]?.label === 'L-1', `label "${(await d.props()).units[0]?.label}"`);

      // Delete a drag-selected group of supports, then add one by hand.
      await d.button('Select supports').click();
      await d.button('Drag over').click();
      await d.idle(2500);
      const before = await d.counts();
      let picked = { selected: 0 };
      for (const [from, to] of [[[0.2, 0.5], [0.55, 0.6]], [[0.2, 0.4], [0.5, 0.7]], [[0.15, 0.6], [0.5, 0.45]]]) {
        await d.stroke(from, to, 24);
        picked = await d.settle();
        if (picked.selected > 0) break;
      }
      await page.screenshot({ path: path.join(scratch, 'ux-b-x6.png') });
      note(`x6 edit-count "${(await page.locator('.edit-count').allInnerTexts()).join('|')}", status "${await d.status()}"`);
      check('x6 Step 3 selects supports with the Support Edit Mode tools', picked.selected > 0, `selected ${picked.selected}`);
      await d.button('Delete').click();
      await d.idle(800);
      const afterDelete = await d.counts();
      check('x7 Delete removes the selected supports', afterDelete.removed > before.removed, `removed ${before.removed} -> ${afterDelete.removed}`);
      await d.button('Add supports').click();
      let added = false;
      for (const point of [[0.5, 0.3], [0.5, 0.7], [0.3, 0.5], [0.7, 0.5], [0.4, 0.4], [0.6, 0.6], [0.35, 0.65], [0.65, 0.35]]) {
        const [px, py] = d.at(...point);
        await page.mouse.click(px, py);
        await d.idle(500);
        if ((await d.counts()).manual > afterDelete.manual) { added = true; break; }
      }
      const handWork = await d.counts();
      check('x8 Add supports adds one by hand', added, `manual ${afterDelete.manual} -> ${handWork.manual}`);

      const raft = page.locator('.dental-side label.check').filter({ hasText: 'Raft' }).locator('input');
      await raft.uncheck();
      check('x5 raft off says the label needs it', await page.getByText('Turn the raft on to print it').isVisible());
      await raft.check();
      await d.quiet();
      // The raft switch rebuilt the supports: wait until the build is on screen before the brush needs it.
      await page.waitForFunction(() => !document.querySelector('footer .building'), null, { timeout: 120000 });
      await d.idle(2500);

      // A setting change regenerates and keeps the hand work.
      const yBefore = (await d.props()).units[0].pos[1];
      await slider('Lift height').focus();
      await slider('Lift height').press('ArrowRight');
      await wait(async () => Math.abs((await d.props()).units[0].pos[1] - yBefore) > 0.2, 'lift regenerated');
      await d.quiet();
      const afterLift = await d.counts();
      check('x9 a lift change regenerates the supports and keeps the manual edits', afterLift.manual === handWork.manual, `manual ${handWork.manual} -> ${afterLift.manual}, removed ${handWork.removed} -> ${afterLift.removed}, status "${await d.status()}"`);

      // Problems: the check runs inside the step and lists what it finds with Show and Fix.
      await d.button('Check for unsupported spots').click();
      await d.quiet();
      await d.idle(800);
      const listed = await page.locator('.dental-side .problems li').count();
      // The one outside-the-support-area note is informational: Show me only, no Fix.
      const notes = await page.locator('.dental-side .problems li:has(.problem-kind.outside)').count();
      check('x10 Check supports inside Step 3 reports into the problem list (each finding has Show me and Fix; the outside-area note only Show me)', listed === 0 || (await page.locator('.dental-side .problems li button').count()) >= 2 * listed - notes, `${listed} listed, ${notes} outside-area note`);
      if (listed > notes) {
        const addButton = page.locator('.dental-side').getByRole('button', { name: 'Add supports' });
        await page.locator('.dental-side').getByRole('button', { name: 'Select supports', exact: true }).click();
        await d.idle(300);
        const addBefore = await addButton.getAttribute('aria-pressed');
        await page.locator('.dental-side .problems li').first().getByRole('button', { name: 'Fix' }).click();
        await d.idle(400);
        const addAfter = await addButton.getAttribute('aria-pressed');
        check('x11 Fix opens Add supports at the spot', addBefore === 'false' && addAfter === 'true', `Add supports pressed ${addBefore} -> ${addAfter}, status "${await d.status()}"`);
      }

      // Back asks first because hand work would be lost; Stay keeps it.
      await d.button('Back').click();
      check('x12 Back from Step 3 asks before discarding manual edits', await page.getByText('Discard and go back').isVisible());
      await page.getByRole('button', { name: 'Stay' }).click();
      check('x13 Stay keeps Step 3 and the edits', (await page.locator('.edit-badge').innerText()).includes('Step 3 · Supports') && (await d.counts()).manual === afterLift.manual);

      // First aligner finished with Add another aligner: back to Step 1 with the same type.
      await d.button('Add another aligner').click();
      await stepTo('Step 1 · Aligner');
      check('x14 Add another aligner returns to Step 1 and asks for the next file, same type',
        await page.getByText('Drop the aligner STL here').isVisible() && (await page.getByRole('button', { name: 'Use the selected model' }).count()) === 0 && (await objects()) === '1');

      // Second aligner.
      await toStep3(false);
      await label.fill('R-2');
      await d.idle(500);
      await page.screenshot({ path: path.join(scratch, 'ux-b-step3-second.png') });
      await d.button('OK').click();
      await page.waitForFunction(() => !document.querySelector('.edit-badge'), null, { timeout: 10000 });
      await d.idle(800);
      await d.quiet();
      await page.getByRole('button', { name: 'Fit', exact: false }).first().click().catch(() => {});
      await d.idle(1200);
      await page.screenshot({ path: path.join(scratch, 'ux-c-plate.png') });
      const finished = await d.props();
      check('x15 OK ends the flow with both aligners on the plate as normal objects, each with supports',
        (await objects()) === '2' && finished.units.length === 2 && finished.units.every((unit) => unit.supports && unit.dental) && (await page.locator('.panel.left [inert]').count()) === 0, `objects ${await objects()}`);
      check('x16 both aligners carry their own label', finished.units[0].label === 'L-1' && finished.units[1].label === 'R-2', `labels ${finished.units.map((unit) => unit.label).join(', ')}`);
      const doneBox = await page.locator('.dental-done').boundingBox();
      check('x17 OK points to Export STL and Save project in a note of normal width (not a one-word column)', await page.locator('.dental-done').isVisible() && /Export STL/.test(await page.locator('.dental-done').innerText()) && Boolean(doneBox) && doneBox.width >= 320 && doneBox.height < 120, `note ${Math.round(doneBox?.width ?? 0)} x ${Math.round(doneBox?.height ?? 0)} px`);

      // The whole-plate export holds both, with free space between them.
      const download = page.waitForEvent('download', { timeout: 600000 });
      await page.getByRole('button', { name: 'Whole plate in one file' }).click();
      const plateFile = path.join(scratch, 'plate.stl');
      await (await download).saveAs(plateFile);
      const { count, xs } = stlVertexXs(readFileSync(plateFile));
      const sorted = [...xs].sort((a, b) => a - b);
      let widest = 0;
      let at = 0;
      for (let i = 1; i < sorted.length; i += 1) if (sorted[i] - sorted[i - 1] > widest) { widest = sorted[i] - sorted[i - 1]; at = i; }
      const leftShare = at / sorted.length;
      check('x18 the export holds both aligners side by side with free space between them (no overlap)', count > 1000 && widest >= 3 && leftShare > 0.2 && leftShare < 0.8, `triangles ${count}, widest empty gap ${widest.toFixed(2)} mm, left share ${(leftShare * 100).toFixed(0)}%`);
      const [first, second] = finished.units;
      check('x19 the two aligners sit apart on the plate', Math.abs(first.pos[0] - second.pos[0]) > 20 || Math.abs(first.pos[2] - second.pos[2]) > 20, `centres ${first.pos.map((v) => v.toFixed(0))} / ${second.pos.map((v) => v.toFixed(0))}`);
    }

    if (dentalFixture) {
      // The opt-in Dental lane never checks a patient model into the repository. The caller gives
      // its local fixture explicitly (for example, `DENTAL_WALK_FIXTURE=... npm run walk`).
      await page.goto(url);
      await d.button('Aligner Support Production').click();
      await page.locator('.dental-card').click();
      await page.setInputFiles('input[aria-label="Choose aligner file"]', dentalFixture);
      await page.waitForFunction(() => document.body.innerText.includes('Review the orientation'), null, { timeout: 180000 });
      await page.screenshot({ path: path.join(scratch, 'dental-orientation.png') });
      check('l0 Step 1 offers orientation and Next without premature Done',
        await d.button('Auto orientation').isVisible() && await d.button('Next').isVisible() && await d.button('Done', false).count() === 0);
      await d.button('Auto orientation').click();
      check('l1 automatic orientation stays in Step 1', (await page.locator('.edit-badge').innerText()).includes('Step 1 · Aligner'));
      await d.button('Next').click();
      await page.waitForFunction(() => document.body.innerText.includes('Step 2 · Support area'), null, { timeout: 90000 });
      await d.idle(1000);
      const approved = await d.props();
      check('l2 dental area holds the two-contour face mask', approved.dentalKind === 'two-contour' && approved.dentalStamps === 0, `policy "${approved.dentalKind}", manual markers ${approved.dentalStamps}`);
      await page.waitForFunction(() => [...document.querySelectorAll('.edit-note')].some((note) => /Proposed support tips: [1-9]/.test(note.innerText)), null, { timeout: 180000 });
      await page.screenshot({ path: path.join(scratch, 'dental-area.png') });
      check('l2b Step 2 offers paint and Next without premature Done',
        await d.button('Add area').isVisible() && await d.button('Remove area').isVisible() && await d.button('Next').isVisible() && await d.button('Done', false).count() === 0);
      const baseline = await d.props();
      const waitForTuning = async (key, value) => {
        for (let attempt = 0; attempt < 300; attempt += 1) {
          const props = await d.props();
          if (props.dentalTuning?.[key] === value) return props;
          await d.idle(200);
        }
        throw new Error(`Dental ${key} did not update to ${value}`);
      };
      const stripWidth = page.locator('.dental-tuning label').filter({ hasText: 'Strip width' }).locator('input');
      await stripWidth.focus();
      await stripWidth.press('ArrowRight');
      const widened = await waitForTuning('stripWidthMm', 1.1);
      check('l2c strip width updates the live painted face mask',
        widened.dentalFaces !== baseline.dentalFaces, `faces ${baseline.dentalFaces} -> ${widened.dentalFaces}`);
      const density = page.locator('.dental-tuning label').filter({ hasText: 'Support density' }).locator('input');
      await density.focus();
      await density.press('ArrowRight');
      const denser = await waitForTuning('density', 1.1);
      await page.waitForFunction(() => [...document.querySelectorAll('.edit-note')].some((note) => /Proposed support tips: [1-9]/.test(note.innerText)), null, { timeout: 180000 });
      check('l2d support density updates the live tip preview',
        denser.dentalContacts !== widened.dentalContacts,
        `candidate tips ${widened.dentalContacts} -> ${denser.dentalContacts}`);
      check('l2f Tree and Brace moved out of Step 2 (they are in Step 3)', (await page.getByText('Tree branches').count()) === 0);
      check('l2g generic right-panel structure controls do not contradict dental Step 2',
        !/Roof \/ cage|Tree supports|Auto placement|Bracing/.test(await page.locator('.panel.right').innerText()));
      await page.locator('.dental-tuning details').filter({ hasText: 'Advanced position' }).locator('summary').click();
      const rimSetback = page.locator('.dental-tuning label').filter({ hasText: 'Rim setback' }).locator('input');
      await rimSetback.focus();
      await rimSetback.press('ArrowRight');
      const shifted = await waitForTuning('setbackMm', 0.3);
      check('l2e rim setback moves the live permitted strip',
        shifted.dentalFaces !== denser.dentalFaces,
        `faces ${denser.dentalFaces} -> ${shifted.dentalFaces}`);
      await d.button('Next').click();
      await page.waitForFunction(() => document.body.innerText.includes('Step 3 · Supports'), null, { timeout: 240000 });
      await page.waitForFunction(() => /[1-9][\d,]* automatic/.test(document.querySelector('footer')?.innerText ?? '') && ![...document.querySelectorAll('button')].some((b) => /Generating dental supports/.test(b.innerText)), null, { timeout: 240000 });
      await d.quiet();
      await d.button('OK').waitFor({ state: 'visible', timeout: 300000 });
      await page.screenshot({ path: path.join(scratch, 'dental-generated.png') });
      const dentalSupports = await d.counts();
      const placed = await d.props();
      check('l3 dental generation finishes a support mesh only after the approved-area stage',
        dentalSupports.auto > 0 && placed.dentalKind === 'two-contour' && placed.tris > 0 && placed.drawn > 0 && placed.droppedDrawn === 0 && Math.abs(placed.dentalReviewGap - 4 / 1.1) < 1e-6,
        `automatic ${dentalSupports.auto}, mesh triangles ${placed.tris}, drawn ${placed.drawn}, forbidden secondary landings dropped ${placed.dropped}, dropped still drawn ${placed.droppedDrawn}, tuned review gap ${placed.dentalReviewGap}`);
      const rimWarning = await page.locator('.dental-side').getByText(/Automatic rim gaps/).innerText();
      check('l4 final dental rim gap is disclosed before Done',
        /Automatic rim gaps: outer [\d.]+ mm, opening [\d.]+ mm/.test(rimWarning) && /Review the rim/.test(rimWarning),
        `warning "${rimWarning}"`);
    }
  } catch (error) {
    check('walk ran to the end', false, error.message);
    await page.screenshot({ path: path.join(scratch, 'walk-error.png') }).catch(() => {});
    note(`screenshot ${path.join(scratch, 'walk-error.png')}`);
  }
  try {
    await page.locator('footer').getByRole('button', { name: 'Terms' }).click();
    const dialog = page.locator('dialog.terms');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    check('j Terms opens the bundled terms in a dialog', /Terms of Use/.test(await dialog.innerText()));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    check('j Escape closes the Terms dialog', true);
  } catch (error) {
    check('j Terms dialog', false, error.message);
  }
  check('h no request leaves localhost', outside.length === 0, outside.length ? outside.slice(0, 3).join(' || ') : '0 external requests');
  check('h no console errors or warnings', errors.length === 0, errors.length ? errors.slice(0, 3).join(' || ') : '0 messages');
}


// ---- locale walk ------------------------------------------------------------------------------
// WALK_LOCALES=en,ja,zh-Hant node scripts/walk.mjs: instead of the English walk, one short pass per
// language (generic Generate + Check on the knot, then the dental Steps 0-3 on the reference aligner
// + Check), driven by the translated labels read from src/locales, with screenshots named
// <lang>-<flow>-<step>.png in WALK_OUT. The full English walk stays the behaviour walk.

/** The translator of one language, read from src/locales/<lang>.ts (English text is the key). */
function translator(lang) {
  if (lang === 'en') return (key) => key;
  const source = readFileSync(path.join(ROOT, 'src', 'locales', `${lang}.ts`), 'utf8');
  const unquote = (text) => text.replace(/\\(['\\])/g, '$1').replace(/\\n/g, '\n');
  const table = new Map();
  for (const m of source.matchAll(/^ {2}'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',\s*$/gm)) table.set(unquote(m[1]), unquote(m[2]));
  return (key) => table.get(key) ?? key;
}

async function walkLocale(url, scratch, lang, dentalFixture) {
  const tr = translator(lang);
  const tag = (name) => `[${lang}] ${name}`;
  const shot = (page, name) => page.screenshot({ path: path.join(scratch, `${lang}-${name}.png`) });
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  await context.addInitScript((value) => { try { localStorage.setItem('mixo-supports.lang', value); } catch { /* storage off */ } }, lang);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const button = (key) => page.getByRole('button', { name: tr(key), exact: true }).first();
  const badgeHas = (key, ms = 20000) => page.waitForFunction((word) => document.querySelector('.edit-badge')?.innerText.includes(word), tr(key), { timeout: ms });
  const quiet = () => page.waitForFunction(() => !!document.querySelector('.job-activity')?.hidden, null, { timeout: 300000 });
  const idle = (ms) => page.evaluate((span) => new Promise((resolve) => setTimeout(resolve, span)), ms);
  try {
    // Generic: knot -> Generate -> Check supports. The knot's island verdict is inconclusive (non-manifold tube).
    await page.goto(url);
    await page.setInputFiles('.drop input[type=file]', FIXTURE);
    await page.waitForFunction(() => document.body.innerText.includes('knot'), null, { timeout: 60000 });
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    check(tag('g0 the page is in the language'), htmlLang === lang && (lang === 'en' || (await button('Aligner Support Production').count()) > 0), `html lang ${htmlLang}`);
    await shot(page, 'generic-1-imported');
    await page.locator('.panel.left .primary').first().click();
    const countsText = tr('{auto} automatic, {manual} manual, {removed} removed');
    // Literal text between the numbers (the separators differ by language); the counts are digits.
    const generated = countsText.split(/\{(?:auto|manual|removed)\}/).map((part) => [...part].map((ch) => (/[A-Za-z0-9\s]/.test(ch) || ch.charCodeAt(0) > 127 ? ch : `\\${ch}`)).join('')).reduce((out, part, k) => out + (k === 0 ? '' : k === 1 ? '[1-9][\\d,]*' : '[\\d,]+') + part, '');
    await page.waitForFunction((source) => new RegExp(source).test(document.querySelector('footer')?.innerText ?? ''), generated, { timeout: 600000 });
    await quiet();
    await idle(800);
    await shot(page, 'generic-2-generated');
    await page.evaluate(() => { window.__statuses = []; new MutationObserver(() => { const text = document.querySelector('footer strong')?.innerText ?? ''; if (text && window.__statuses.at(-1) !== text) window.__statuses.push(text); }).observe(document.querySelector('footer'), { subtree: true, childList: true, characterData: true }); });
    // A Check pressed before the preview build lands says "did not finish" (never clean); press it again once the build is in.
    const unfinished = tr('The check did not finish for 1 object: run it again.');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await button('Check for unsupported spots').click();
      await idle(1500);
      await quiet();
      await idle(500);
      if ((await page.evaluate(() => document.querySelector('footer strong')?.innerText ?? '')) !== unfinished) break;
      note(`[${lang}] Check pressed before the build landed: "${unfinished}", pressing again`);
      await idle(3000);
    }
    await page.waitForSelector('.problems li', { timeout: 300000 });
    await quiet();
    await idle(500);
    const rows = await page.locator('.problems li').evaluateAll((items) => items.map((li) => ({ text: li.innerText, buttons: li.querySelectorAll('button').length })));
    const unjudged = rows.find((row) => row.text.includes(tr('Could not judge islands on this mesh')));
    const status = await page.evaluate(() => document.querySelector('footer strong')?.innerText ?? '');
    check(tag('g1 Check lists "could not judge islands" for the knot, with no Show or Fix on it'), Boolean(unjudged) && unjudged.buttons === 0 && unjudged.text.includes(tr('This mesh has defects, such as edges shared by more than two faces, so no island is called supported. Repair the model, then check again.')), `rows ${rows.length}, first "${rows[0]?.text.replace(/\s+/g, ' ')}"`);
    const said = status.includes(tr('Islands could not be judged on 1 object.')) || status.includes(tr('Islands could not be judged on 1 object: see Check supports.'));
    check(tag('g2 the status line never says clean while islands are unjudged'), status !== tr('No unsupported spots found.') && said, `status "${status}"`);
    await page.locator('.problems li').last().scrollIntoViewIfNeeded();
    await shot(page, 'generic-3-problem-list');
    note(`[${lang}] statuses after Check: ${JSON.stringify(await page.evaluate(() => window.__statuses))}`);
    note(`[${lang}] problem rows: ${JSON.stringify(rows.map((row) => row.text.replace(/\s+/g, ' ')))}`);

    // Dental: Step 0 -> 3 on the reference aligner, then Check.
    const reference = dentalFixture ?? path.join(ROOT, 'docs', 'dental-reference', 'reference-aligner.stl');
    await page.goto(url);
    await button('Aligner Support Production').click();
    await badgeHas('Step 0 · Aligner type');
    await shot(page, 'dental-step0');
    await page.locator('.dental-card').click();
    await badgeHas('Step 1 · Aligner');
    await shot(page, 'dental-step1');
    await page.setInputFiles(`input[aria-label="${tr('Choose aligner file')}"]`, reference);
    await badgeHas('Review the orientation. Turn the aligner with the gizmo if needed.', 180000);
    await button('Next').click();
    await badgeHas('Step 2 · Support area', 180000);
    await page.waitForFunction(() => [...document.querySelectorAll('.edit-note')].some((note) => /[1-9]/.test(note.innerText)), null, { timeout: 240000 });
    await idle(800);
    await shot(page, 'dental-step2');
    await button('Next').click();
    await badgeHas('Step 3 · Supports', 240000);
    await page.waitForFunction((ok) => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ok); return b && !b.disabled; }, tr('OK'), { timeout: 300000 });
    await quiet();
    await idle(800);
    await shot(page, 'dental-step3');
    await page.locator('.dental-side').getByRole('button', { name: tr('Check for unsupported spots'), exact: true }).click();
    const none = tr('No problems listed. Press Check supports to look for islands and overhangs.');
    await idle(1500);
    await quiet();
    await page.waitForFunction((word) => document.querySelector('.dental-side .problems li') || document.querySelector('.dental-side')?.innerText.includes(word), none, { timeout: 120000 }).catch(() => {});
    await idle(800);
    const side = await page.locator('.dental-side').innerText();
    const listed = await page.locator('.dental-side .problems li').evaluateAll((items) => items.map((li) => li.innerText.replace(/\s+/g, ' ')));
    check(tag('d1 Step 3 Check ends in the problem list (rows) or the translated empty note'), listed.length > 0 || side.includes(none), `rows ${JSON.stringify(listed)}`);
    const badge = (await page.locator('.edit-badge').innerText()).replace(/\s+/g, ' ');
    check(tag('d2 Step 3 badge is in the language'), lang === 'en' ? badge.includes('Step 3 ·') : !badge.includes('Step 3 ·'), badge);
    await page.locator('.dental-side .problems li').last().scrollIntoViewIfNeeded().catch(() => {});
    note(`[${lang}] dental island verdict: ${JSON.stringify((await page.evaluate(readProps)).islands)}`);
    await shot(page, 'dental-step3-problems');
  } catch (error) {
    check(tag('locale walk'), false, error.message);
    await shot(page, 'error').catch(() => {});
  }
  check(tag('h no console errors or warnings'), errors.length === 0, errors.length ? errors.slice(0, 3).join(' || ') : '0 messages');
  await context.close();
}

// WALK_OUT: where a run leaves its screenshots and files for review; ordinary passing runs remove them.
const scratch = process.env.WALK_LOCALES && process.env.WALK_OUT ? (mkdirSync(path.resolve(process.env.WALK_OUT), { recursive: true }), path.resolve(process.env.WALK_OUT)) : process.env.WALK_OUT ? (mkdirSync(path.resolve(process.env.WALK_OUT), { recursive: true }), mkdtempSync(path.join(path.resolve(process.env.WALK_OUT), 'run-'))) : mkdtempSync(path.join(tmpdir(), 'mixo-walk-'));
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
  const dentalFixture = process.env.DENTAL_WALK_FIXTURE;
  if (process.env.WALK_LOCALES) {
    browser = await launch();
    for (const lang of process.env.WALK_LOCALES.split(',').map((item) => item.trim()).filter(Boolean)) await walkLocale(url, scratch, lang, dentalFixture);
  } else await walk(url, scratch, dentalFixture);
} catch (error) {
  check('walk setup', false, error.message);
} finally {
  await stopAll();
}
const failed = results.filter((r) => !r.ok).length;
if (failed === 0 && !process.env.WALK_OUT && !process.env.WALK_LOCALES) rmSync(scratch, { recursive: true, force: true });
console.log(`${failed === 0 ? 'ALL PASS' : `${failed} FAIL`} (${results.length} checks, ${Math.round((Date.now() - started) / 1000)} s)`);
process.exit(failed === 0 ? 0 : 1);
