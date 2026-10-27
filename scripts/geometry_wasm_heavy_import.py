"""Exercise the real browser import worker's Rust display-decimation branch above the heavy threshold."""

from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        page = browser.new_page()
        page.set_default_timeout(150_000)
        page.goto("http://127.0.0.1:5173/mixo-supports/")
        result = page.evaluate(
            """async () => {
              const side = 868;
              const row = side + 1;
              const positions = new Float32Array(row * row * 3);
              const indices = new Uint32Array(side * side * 6);
              for (let y = 0; y <= side; y++) {
                for (let x = 0; x <= side; x++) {
                  const offset = (y * row + x) * 3;
                  positions[offset] = x * 0.1;
                  positions[offset + 1] = y * 0.1;
                  positions[offset + 2] = Math.sin(x * 0.02) * Math.cos(y * 0.02);
                }
              }
              let at = 0;
              for (let y = 0; y < side; y++) {
                for (let x = 0; x < side; x++) {
                  const a = y * row + x;
                  indices.set([a, a + row, a + 1, a + row, a + row + 1, a + 1], at);
                  at += 6;
                }
              }
              const worker = new Worker('/mixo-supports/src/workers/importWorker.ts', { type: 'module' });
              return new Promise((resolve, reject) => {
                const start = performance.now();
                const timer = setTimeout(() => { worker.terminate(); reject(new Error('heavy import timed out')); }, 120000);
                worker.onmessage = ({ data }) => {
                  if (data.type !== 'done' && data.type !== 'error') return;
                  clearTimeout(timer);
                  worker.terminate();
                  if (data.type === 'error') reject(new Error(`${data.code ?? ''}: ${data.message}`));
                  else {
                    const item = data.result[0];
                    resolve({ elapsedMs: performance.now() - start,
                      sourceTriangles: item.mesh.indices.length / 3,
                      displayTriangles: item.display?.indices.length / 3 ?? null,
                      sourceVertices: item.mesh.positions.length / 3,
                      displayVertices: item.display?.positions.length / 3 ?? null,
                      pickRoots: item.bvh.roots.length });
                  }
                };
                worker.onerror = event => {
                  clearTimeout(timer);
                  worker.terminate();
                  reject(new Error(event.message));
                };
                worker.postMessage({ id: 1, type: 'run', payload: {
                  kind: 'weld', runtime: 'web', meshes: [{ name: 'heavy-grid', positions, indices,
                    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
                }}, [positions.buffer, indices.buffer]);
              });
            }"""
        )
        assert result["sourceTriangles"] == 2 * 868 * 868, result
        assert 0 < result["displayTriangles"] <= 750_000, result
        assert 0 < result["displayVertices"] < result["sourceVertices"], result
        assert result["pickRoots"] > 0, result
        print(f"heavy import browser-worker Rust decimation: PASS {result}")
    finally:
        browser.close()
