import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@aesyclaw/sdk': resolve(__dirname, 'src/sdk/index.ts'),
      '@aesyclaw': resolve(__dirname, 'src'),
      '@': resolve(__dirname, 'web/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'web/src/**/*.test.ts'],
  },
});
