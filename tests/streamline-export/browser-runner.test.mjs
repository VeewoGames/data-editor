import test from "node:test";
import assert from "node:assert/strict";
import {
  connectChromeBrowser,
  runStreamlineSvgExtractionFromNodeRepl,
  runStreamlineSvgExtractionLoopFromNodeRepl,
} from "../../scripts/streamline-export/run-streamline-svg-export-session.mjs";
import { createManifest, markManifestItemSuccess } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  const acquireTab = async () => ({ id: "tab-1" });
  const result = await runStreamlineSvgExtractionFromNodeRepl({
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json",
    sessionName: "runner-test",
    attempts: 7,
    waitMs: 111,
    maxItems: 9,
    acquireTab,
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
      maxItems: 9,
      acquireTab,
    },
  ]);
});

test("runStreamlineSvgExtractionLoopFromNodeRepl batches until manifest is complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-loop-"));
  const manifestPath = join(root, "micro-line.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-line",
    items: [
      { slug: "align-top", name: "Align Top", iconUrl: "https://example.test/align-top" },
      { slug: "atom", name: "Atom", iconUrl: "https://example.test/atom" },
      { slug: "beach", name: "Beach", iconUrl: "https://example.test/beach" },
    ],
    outputDir: "vendor/streamline-svg/micro-line",
  });

  const connectCalls = [];
  const runCalls = [];
  const slugBatches = [
    ["align-top", "atom"],
    ["beach"],
  ];

  const result = await runStreamlineSvgExtractionLoopFromNodeRepl({
    manifestPath,
    batchSize: 2,
    maxBatches: 3,
    connectBrowser: async () => {
      const browser = { id: `browser-loop-${connectCalls.length + 1}` };
      connectCalls.push(browser.id);
      return browser;
    },
    runWithBrowser: async (options) => {
      runCalls.push({ sessionName: options.sessionName, maxItems: options.maxItems, browser: options.browser });
      for (const slug of slugBatches.shift() ?? []) {
        await markManifestItemSuccess({ manifestPath, slug, extractedAt: "2026-06-23T10:00:00.000Z" });
      }
      return { success: options.maxItems, failed: 0 };
    },
  });

  assert.deepEqual(connectCalls, ["browser-loop-1", "browser-loop-2"]);
  assert.equal(runCalls.length, 2);
  assert.equal(runCalls[0].browser.id, "browser-loop-1");
  assert.equal(runCalls[1].browser.id, "browser-loop-2");
  assert.equal(runCalls[0].maxItems, 2);
  assert.equal(runCalls[1].maxItems, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.after, {
    total: 3,
    pending: 0,
    success: 3,
    failed: 0,
  });
});

test("runStreamlineSvgExtractionLoopFromNodeRepl can reuse one browser across batches when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-loop-"));
  const manifestPath = join(root, "micro-line.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-line",
    items: [
      { slug: "align-top", name: "Align Top", iconUrl: "https://example.test/align-top" },
      { slug: "atom", name: "Atom", iconUrl: "https://example.test/atom" },
      { slug: "beach", name: "Beach", iconUrl: "https://example.test/beach" },
    ],
    outputDir: "vendor/streamline-svg/micro-line",
  });

  const sharedBrowser = { id: "browser-shared" };
  const connectCalls = [];
  const runCalls = [];
  const slugBatches = [
    ["align-top", "atom"],
    ["beach"],
  ];

  const result = await runStreamlineSvgExtractionLoopFromNodeRepl({
    manifestPath,
    batchSize: 2,
    maxBatches: 3,
    reuseBrowser: true,
    connectBrowser: async () => {
      connectCalls.push("connect");
      return sharedBrowser;
    },
    runWithBrowser: async (options) => {
      runCalls.push(options.browser);
      for (const slug of slugBatches.shift() ?? []) {
        await markManifestItemSuccess({ manifestPath, slug, extractedAt: "2026-06-23T10:00:00.000Z" });
      }
      return { success: options.maxItems, failed: 0 };
    },
  });

  assert.deepEqual(connectCalls, ["connect"]);
  assert.deepEqual(runCalls, [sharedBrowser, sharedBrowser]);
  assert.equal(result.complete, true);
});
