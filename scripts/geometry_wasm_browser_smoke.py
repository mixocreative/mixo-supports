"""Check that Vite can load and execute the generated browser WASM package."""

from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        page = browser.new_page()
        page.goto("http://127.0.0.1:5173/mixo-supports/")
        page.wait_for_load_state("networkidle")
        package_url = "http://127.0.0.1:5173/mixo-supports/crates/geometry-wasm/pkg-browser/mixo_geometry_wasm.js"
        response = page.request.get(package_url)
        assert response.ok, f"Vite browser package returned HTTP {response.status}: {response.text()[:200]}"
        result = page.evaluate(
            """async () => {
              const { geometryReady } = await import('/mixo-supports/src/workers/geometryClient.ts');
              const engine = await geometryReady();
              const session = new engine.GeometrySession(48);
              const handle = session.load_mesh(
                new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
                new Uint32Array([0, 1, 2]),
              );
              const bounds = Array.from(session.mesh_bounds(handle));
              session.release_mesh(handle);
              let staleCode;
              try { session.mesh_bounds(handle); } catch (error) { staleCode = error.code; }
              const used = session.used_bytes();
              session.free();
              return { version: engine.engine_version(), bounds, used, staleCode };
            }"""
        )
        assert result == {"version": 1, "bounds": [0, 0, 0, 2, 3, 0], "used": 0, "staleCode": "INVALID_HANDLE"}, result
        worker_result = page.evaluate(
            """async () => new Promise((resolve, reject) => {
              const worker = new Worker('/mixo-supports/src/workers/meshWorker.ts', { type: 'module' });
              const timer = setTimeout(() => { worker.terminate(); reject(new Error('mesh worker timed out')); }, 10000);
              worker.onmessage = ({ data }) => {
                if (data.type !== 'done' && data.type !== 'error') return;
                clearTimeout(timer);
                worker.terminate();
                if (data.type === 'error') reject(new Error(data.message));
                else resolve(data.result.kind);
              };
              worker.onerror = (event) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(event.message));
              };
              worker.postMessage({ id: 1, type: 'run', payload: {
                kind: 'build', unit: { unitId: 'wasm-smoke', sourceToken: 'missing', job: {} }
              }});
            })"""
        )
        assert worker_result == 'need-source', f"unexpected mesh worker result: {worker_result}"
        import_result = page.evaluate(
            """async () => new Promise((resolve, reject) => {
              const worker = new Worker('/mixo-supports/src/workers/importWorker.ts', { type: 'module' });
              const timer = setTimeout(() => { worker.terminate(); reject(new Error('import worker timed out')); }, 15000);
              worker.onmessage = ({ data }) => {
                if (data.type !== 'done' && data.type !== 'error') return;
                clearTimeout(timer);
                worker.terminate();
                if (data.type === 'error') reject(new Error(data.message));
                else resolve({ center: data.result[0].centred.center,
                  positions: Array.from(data.result[0].mesh.positions) });
              };
              worker.onerror = (event) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(event.message));
              };
              worker.postMessage({ id: 2, type: 'run', payload: {
                kind: 'weld', runtime: 'web', meshes: [{
                  name: 'wasm-center',
                  positions: new Float32Array([8, -2, 4, 12, -2, 4, 8, 4, 4]),
                  indices: new Uint32Array([0, 1, 2]),
                  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                }],
              }});
            })"""
        )
        assert import_result == {"center": [10, 1, 4], "positions": [-2, -3, 0, 2, -3, 0, -2, 3, 0]}, import_result
        print("browser WASM version and mesh session: PASS")
    finally:
        browser.close()
