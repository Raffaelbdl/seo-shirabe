import { defineConfig } from '@playwright/test';

// E2E: loads the built extension (pnpm build:e2e) into Chromium and audits
// local fixture pages served by tests/e2e/server.ts.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
});
