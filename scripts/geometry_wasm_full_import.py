"""Exercise binary STL import, centering and pick-index creation on the saved full aligner."""

from pathlib import Path
from struct import unpack_from
from playwright.sync_api import sync_playwright


fixture = Path("docs/dental-reference/reference-aligner.stl").read_bytes()
triangle_count = unpack_from("<I", fixture, 80)[0]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        page = browser.new_page()
        page.set_default_timeout(150_000)
        page.route(
            "**/reference-aligner.stl",
            lambda route: route.fulfill(body=fixture, content_type="application/octet-stream"),
        )
        page.goto("http://127.0.0.1:5173/mixo-supports/")
        result = page.evaluate(
            """async () => {
              const response = await fetch('/mixo-supports/reference-aligner.stl');
              if (!response.ok) throw new Error(`fixture HTTP ${response.status}`);
              const file = await response.blob();
              return new Promise((resolve, reject) => {
                const worker = new Worker('/mixo-supports/src/workers/importWorker.ts', { type: 'module' });
                const start = performance.now();
                const timer = setTimeout(() => { worker.terminate(); reject(new Error('full import timed out')); }, 120000);
                worker.onmessage = ({ data }) => {
                  if (data.type !== 'done' && data.type !== 'error') return;
                  clearTimeout(timer);
                  worker.terminate();
                  if (data.type === 'error') reject(new Error(`${data.code ?? ''}: ${data.message}`));
                  else {
                    const prepared = data.result[0];
                    resolve({ elapsedMs: performance.now() - start,
                      triangles: prepared.mesh.indices.length / 3,
                      vertices: prepared.mesh.positions.length / 3,
                      centered: prepared.centred.center.every(Number.isFinite),
                      pickRoots: prepared.bvh.roots.length });
                  }
                };
                worker.onerror = (event) => {
                  clearTimeout(timer);
                  worker.terminate();
                  reject(new Error(event.message));
                };
                worker.postMessage({ id: 1, type: 'run', payload: {
                  kind: 'stl', name: 'reference-aligner.stl', file, runtime: 'web',
                }});
              });
            }"""
        )
        assert result["triangles"] == triangle_count, result
        assert 0 < result["vertices"] < triangle_count * 3, result
        assert result["centered"] and result["pickRoots"] > 0, result
        print(f"full binary STL browser-worker import: PASS {result}")
    finally:
        browser.close()
