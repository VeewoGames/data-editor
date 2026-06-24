import { defineConfig } from "@playwright/test";

const port = process.env.DATA_EDITOR_E2E_PORT ?? "42173";
const bridgePort = process.env.DATA_EDITOR_E2E_BRIDGE_PORT ?? "42175";
const registryHome = "./tests/.scratch/.data-editor/e2e-home";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: `node tests/fixtures/make-scratch-root.mjs && npm run build && node server.mjs --project ./tests/.scratch --port ${port} --static dist --bridge-port ${bridgePort} --registry-home ${registryHome}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
