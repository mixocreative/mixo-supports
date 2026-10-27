import { defineConfig } from 'vite';

export default defineConfig({
  base: '/mixo-supports/',
  build: {
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
  test: {
    environment: 'node',
    setupFiles: ['scripts/test-support/useNodeEngine.ts'],
  },
});
