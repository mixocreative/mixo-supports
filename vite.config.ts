import { defineConfig } from 'vite';

export default defineConfig({
  base: '/mixo-supports/',
  build: {
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
  test: {
    environment: 'node',
    setupFiles: ['scripts/test-support/useNodeEngine.ts'],
    // Heavy aligner fixtures and first WASM engine load exceed the 5 s default under load.
    testTimeout: 60000,
    // Worker threads drop onTaskUpdate RPCs under heavy WASM load; forks do not.
    pool: 'forks',
  },
});
