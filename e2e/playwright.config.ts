import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { browserName: 'chromium', trace: 'on-first-retry' },
});
