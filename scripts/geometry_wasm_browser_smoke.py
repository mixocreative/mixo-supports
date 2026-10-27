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
              const display = engine.decimate_display(
                new Float32Array([0, 0, 0, 0.01, 0, 0, 1, 0, 0, 0, 1, 0]),
                new Uint32Array([0, 1, 2, 0, 2, 3]), 1);
              const displayTriangles = display.take_indices().length / 3;
              display.free();
              return { version: engine.engine_version(), bounds, used, staleCode, displayTriangles };
            }"""
        )
        assert result == {"version": 1, "bounds": [0, 0, 0, 2, 3, 0], "used": 0, "staleCode": "INVALID_HANDLE", "displayTriangles": 1}, result
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
                  positions: Array.from(data.result[0].mesh.positions),
                  indices: Array.from(data.result[0].mesh.indices) });
              };
              worker.onerror = (event) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(event.message));
              };
              worker.postMessage({ id: 2, type: 'run', payload: {
                kind: 'weld', runtime: 'web', meshes: [{
                  name: 'wasm-center',
                  positions: new Float32Array([8, -2, 4, 12, -2, 4, 8, 4, 4, 8, -2, 4]),
                  indices: new Uint32Array([0, 1, 2, 3, 1, 2]),
                  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                }],
              }});
            })"""
        )
        assert import_result == {"center": [10, 1, 4], "positions": [-2, -3, 0, 2, -3, 0, -2, 3, 0], "indices": [0, 1, 2, 0, 1, 2]}, import_result
        stl_import = page.evaluate(
            """async () => new Promise((resolve, reject) => {
              const bytes = new Uint8Array(134);
              const view = new DataView(bytes.buffer);
              view.setUint32(80, 1, true);
              [0, 0, 0, 2, 0, 0, 0, 0, 2].forEach((value, index) => view.setFloat32(96 + index * 4, value, true));
              const worker = new Worker('/mixo-supports/src/workers/importWorker.ts', { type: 'module' });
              const timer = setTimeout(() => { worker.terminate(); reject(new Error('binary STL import timed out')); }, 15000);
              worker.onmessage = ({ data }) => {
                if (data.type !== 'done' && data.type !== 'error') return;
                clearTimeout(timer);
                worker.terminate();
                if (data.type === 'error') reject(new Error(data.message));
                else resolve({ center: data.result[0].centred.center,
                  indices: Array.from(data.result[0].mesh.indices),
                  vertices: data.result[0].mesh.positions.length / 3 });
              };
              worker.onerror = (event) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(event.message));
              };
              worker.postMessage({ id: 4, type: 'run', payload: {
                kind: 'stl', name: 'wasm-binary.stl', runtime: 'web', file: new Blob([bytes]),
              }});
            })"""
        )
        assert stl_import["indices"] == [0, 1, 2] and stl_import["vertices"] == 3, stl_import
        assert stl_import["center"][0:2] == [1, 1], stl_import
        ascii_import = page.evaluate(
            """async () => new Promise((resolve, reject) => {
              const bytes = new TextEncoder().encode('solid x\\nvertex 0 0 0\\nvertex 2 0 0\\nvertex 0 0 2\\nendsolid x');
              const worker = new Worker('/mixo-supports/src/workers/importWorker.ts', { type: 'module' });
              const timer = setTimeout(() => { worker.terminate(); reject(new Error('ASCII STL import timed out')); }, 15000);
              worker.onmessage = ({ data }) => {
                if (data.type !== 'done' && data.type !== 'error') return;
                clearTimeout(timer);
                worker.terminate();
                if (data.type === 'error') reject(new Error(data.message));
                else resolve({ center: data.result[0].centred.center,
                  indices: Array.from(data.result[0].mesh.indices),
                  vertices: data.result[0].mesh.positions.length / 3 });
              };
              worker.onerror = event => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(event.message));
              };
              worker.postMessage({ id: 5, type: 'run', payload: {
                kind: 'stl', name: 'wasm-ascii.stl', runtime: 'web', file: new Blob([bytes]),
              }});
            })"""
        )
        assert ascii_import["indices"] == [0, 1, 2] and ascii_import["vertices"] == 3, ascii_import
        assert ascii_import["center"][0:2] == [1, 1], ascii_import
        invalid_import = page.evaluate(
            """async () => new Promise((resolve, reject) => {
              const worker = new Worker('/mixo-supports/src/workers/importWorker.ts', { type: 'module' });
              const timer = setTimeout(() => { worker.terminate(); reject(new Error('invalid import timed out')); }, 15000);
              worker.onmessage = ({ data }) => {
                if (data.type !== 'done' && data.type !== 'error') return;
                clearTimeout(timer);
                worker.terminate();
                resolve({ type: data.type, code: data.code });
              };
              worker.onerror = (event) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(event.message));
              };
              worker.postMessage({ id: 3, type: 'run', payload: {
                kind: 'weld', runtime: 'web', meshes: [{
                  name: 'invalid', positions: new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0]),
                  indices: new Uint32Array([0, 1, 2]),
                  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                }],
              }});
            })"""
        )
        assert invalid_import == {"type": "error", "code": "non-finite"}, invalid_import
        print("browser WASM version and mesh session: PASS")
    finally:
        browser.close()
