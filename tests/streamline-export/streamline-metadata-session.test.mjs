import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STREAMLINE_HUMAN_METADATA_PACING,
  runStreamlineMetadataExtractionWithBrowser,
} from "../../scripts/streamline-export/lib/streamline-metadata-session.mjs";

test("runStreamlineMetadataExtractionWithBrowser uses parallel extraction when concurrency > 1", async () => {
  const calls = [];
  const primaryTab = { id: "primary" };
  const extraTab = { id: "extra" };
  const browser = {
    async nameSession(name) {
      calls.push(["nameSession", name]);
    },
    user: {
      async openTabs() {
        calls.push(["openTabs"]);
        return [];
      },
    },
    tabs: {
      async new() {
        calls.push(["new"]);
        return extraTab;
      },
      async finalize(options) {
        calls.push(["finalize", options]);
      },
    },
  };

  const result = await runStreamlineMetadataExtractionWithBrowser({
    browser,
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
    sessionName: "parallel-metadata",
    waitMs: 250,
    maxItems: 6,
    force: true,
    concurrency: 2,
    acquireTab: async () => primaryTab,
    runManifestMetadataExtractionParallel: async (options) => {
      calls.push(["parallel", options]);
      return { success: 6, failed: 0 };
    },
  });

  assert.deepEqual(result, { success: 6, failed: 0 });
  assert.equal(calls[0][0], "nameSession");
  assert.equal(calls.some(([name]) => name === "parallel"), true);
  const parallelCall = calls.find(([name]) => name === "parallel");
  assert.deepEqual(parallelCall?.[1].tabs, [primaryTab, extraTab]);
  assert.equal(parallelCall?.[1].maxItems, 6);
  assert.equal(parallelCall?.[1].waitMs, 250);
  assert.deepEqual(calls.at(-1), ["finalize", { keep: [{ tab: primaryTab, status: "handoff" }] }]);
});

test("runStreamlineMetadataExtractionWithBrowser forwards paced options in serial human mode", async () => {
  const calls = [];
  const primaryTab = { id: "primary" };
  const browser = {
    async nameSession(name) {
      calls.push(["nameSession", name]);
    },
    user: {
      async openTabs() {
        return [];
      },
    },
    tabs: {
      async finalize(options) {
        calls.push(["finalize", options]);
      },
    },
  };

  const result = await runStreamlineMetadataExtractionWithBrowser({
    browser,
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
    humanMode: true,
    acquireTab: async () => primaryTab,
    runManifestMetadataExtraction: async (options) => {
      calls.push(["serial", options]);
      return { success: 2, failed: 0 };
    },
  });

  assert.deepEqual(result, { success: 2, failed: 0 });
  const serialCall = calls.find(([name]) => name === "serial");
  assert.equal(serialCall?.[1].tab, primaryTab);
  assert.equal(serialCall?.[1].waitMs, 500);
  assert.equal(serialCall?.[1].preNavigationDelayMs, 0);
  assert.equal(serialCall?.[1].postItemDelayMs, 0);
  assert.deepEqual(calls.at(-1), ["finalize", { keep: [{ tab: primaryTab, status: "handoff" }] }]);
  assert.notDeepEqual(DEFAULT_STREAMLINE_HUMAN_METADATA_PACING, null);
});

test("runStreamlineMetadataExtractionWithBrowser rejects parallel human mode", async () => {
  await assert.rejects(
    () => runStreamlineMetadataExtractionWithBrowser({
      browser: {
        async nameSession() {},
        user: { async openTabs() { return []; } },
        tabs: { async finalize() {}, async new() { return { id: "extra" }; } },
      },
      manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
      concurrency: 2,
      humanMode: true,
      acquireTab: async () => ({ id: "primary" }),
    }),
    /humanMode requires concurrency = 1/,
  );
});
