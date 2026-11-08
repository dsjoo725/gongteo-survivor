import { defineConfig } from '@playwright/test';

const url = 'http://127.0.0.1:4176';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  // Some regression cases reload the complete local painting/font set repeatedly.
  timeout: 60_000,
  use: { browserName: 'chromium', baseURL: url },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4176 --strictPort',
    url,
  },
});
