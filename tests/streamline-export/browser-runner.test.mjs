import test from "node:test";
import assert from "node:assert/strict";
import {
  connectChromeBrowser,
  runStreamlineSvgExtractionFromNodeRepl,
} from "../../scripts/streamline-export/run-streamline-svg-export-session.mjs";

test("connectChromeBrowser wires setup and browser acquisition", async () => {
  const calls = [];
  const fakeBrowser = { id: "browser-1" };
  const globals = {};
  const browser = await connectChromeBrowser({
    setupBrowserRuntime: async ({ globals: receivedGlobals }) => {
      calls.push(["setup", receivedGlobals === globals]);
      receivedGlobals.agent = {
        browsers: {
          async get(id) {
            calls.push(["get", id]);
            return fakeBrowser;
          },
        },
      };
    },
    globals,
  });

  assert.equal(browser, fakeBrowser);
  assert.deepEqual(calls, [
    ["setup", true],
    ["get", "extension"],
  ]);
});

test("runStreamlineSvgExtractionFromNodeRepl delegates to browser runner", async () => {
  const calls = [];
  const result = await runStreamlineSvgExtractionFromNodeRepl({
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json",
    sessionName: "runner-test",
    attempts: 7,
    waitMs: 111,
    connectBrowser: async () => {
      calls.push(["connectBrowser"]);
      return { id: "browser-2" };
    },
    runWithBrowser: async (options) => {
      calls.push(["runWithBrowser", options]);
      return { success: 10, failed: 0 };
    },
  });

  assert.deepEqual(result, { success: 10, failed: 0 });
  assert.equal(calls[0][0], "connectBrowser");
  assert.deepEqual(calls[1], [
    "runWithBrowser",
    {
      browser: { id: "browser-2" },
      manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json",
      sessionName: "runner-test",
      attempts: 7,
      waitMs: 111,
    },
  ]);
});
