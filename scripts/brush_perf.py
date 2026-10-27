"""Brush step timing in headless Chromium against a managed vite server: prints JSON (see scripts/perf/brushBench.ts)."""

import json
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/mixo-supports/"
server = subprocess.Popen("npx vite --host 127.0.0.1 --port 5173", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(120):
        try:
            urllib.request.urlopen(URL, timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(URL)
            page.wait_for_load_state("networkidle")
            result = page.evaluate("async () => (await import('/mixo-supports/scripts/perf/brushBench.ts')).run(20)")
            print(json.dumps(result, indent=2))
        finally:
            browser.close()
finally:
    subprocess.run(f"taskkill /F /T /PID {server.pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
