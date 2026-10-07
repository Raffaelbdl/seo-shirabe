import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One Chromium is shared per test file for DOM extraction; files run in parallel.
    pool: 'forks',
  },
});
