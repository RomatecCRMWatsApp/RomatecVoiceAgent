import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10000,
    // Tests que precisam de MySQL/Anthropic/etc devem mockar ou ser skipados
    // se a env nao tiver as keys. Por padrao roda sem dependencias externas.
    setupFiles: ['./src/test-setup.ts'],
  },
});
