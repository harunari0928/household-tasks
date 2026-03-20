import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'DB_PATH=data/test_task_definitions.db PORT=3101 VIKUNJA_URL=http://127.0.0.1:3199/api/v1 VIKUNJA_API_TOKEN=test-token npx tsx packages/web/src/server/index.ts',
      url: 'http://localhost:3101/api/tasks',
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    },
    {
      command: 'cd packages/web && API_PORT=3101 npx vite --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    },
  ],
});
