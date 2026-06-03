import { defineConfig } from "@playwright/test";

const port = process.env.DATA_EDITOR_E2E_PORT ?? "8787";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: `node tests/fixtures/make-scratch-root.mjs && npm run dev -- --project ./tests/.scratch --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
