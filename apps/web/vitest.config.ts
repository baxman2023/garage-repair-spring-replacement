import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // DB-backed integration tests need MariaDB; they self-skip when absent.
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
