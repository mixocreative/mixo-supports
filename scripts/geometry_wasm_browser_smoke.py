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
        version = page.evaluate(
            """async () => {
              const module = await import('/mixo-supports/crates/geometry-wasm/pkg-browser/mixo_geometry_wasm.js');
              await module.default('/mixo-supports/crates/geometry-wasm/pkg-browser/mixo_geometry_wasm_bg.wasm');
              return module.engine_version();
            }"""
        )
        assert version == 1, f"browser WASM schema version {version} != 1"
        print("browser WASM version handshake: PASS")
    finally:
        browser.close()
