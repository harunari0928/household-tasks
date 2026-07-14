import { defineConfig } from '@playwright/test';

// worktree並行開発時はポート競合を避けるため環境変数で上書きする
// 例: TEST_API_PORT=3102 TEST_WEB_PORT=5175 npx playwright test
const API_PORT = process.env.TEST_API_PORT || '3101';
const WEB_PORT = process.env.TEST_WEB_PORT || '5174';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `DB_PATH=data/test_task_definitions.db PORT=${API_PORT} npx tsx packages/web/src/server/index.ts`,
      url: `http://localhost:${API_PORT}/api/tasks`,
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    },
    {
      command: `cd packages/web && API_PORT=${API_PORT} npx vite --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    },
  ],
});
