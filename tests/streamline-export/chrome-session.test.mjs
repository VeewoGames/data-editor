import test from "node:test";
import assert from "node:assert/strict";
import {
  claimStreamlineTab,
  findPreferredStreamlineTab,
  openStreamlineTab,
  runStreamlineSvgExtractionWithBrowser,
} from "../../scripts/streamline-export/lib/chrome-session.mjs";

test("findPreferredStreamlineTab prefers Streamline detail pages", () => {
  const tab = findPreferredStreamlineTab([
    { id: "1", url: "https://www.streamlinehq.com/profile" },
    { id: "2", url: "https://www.streamlinehq.com/icons/download/cut-scissor--26582" },
  ]);

  assert.equal(tab.id, "2");
});

test("findPreferredStreamlineTab falls back to generic Streamline tab", () => {
  const tab = findPreferredStreamlineTab([
    { id: "1", url: "https://www.example.com/" },
    { id: "2", url: "https://www.streamlinehq.com/icons/micro-solid" },
  ]);

  assert.equal(tab.id, "2");
});

test("claimStreamlineTab claims the preferred tab", async () => {
  const claimed = { id: "claimed-tab" };
  const browser = {
    user: {
      async openTabs() {
        return [{ id: "2", url: "https://www.streamlinehq.com/icons/download/cut-scissor--26582" }];
      },
      async claimTab(tab) {
        assert.equal(tab.id, "2");
        return claimed;
      },
    },
  };

  const tab = await claimStreamlineTab(browser);
  assert.equal(tab, claimed);
});

test("openStreamlineTab creates a new tab and navigates to streamline", async () => {
  const calls = [];
  const createdTab = {
    async goto(url) {
      calls.push(["goto", url]);
    },
  };
  const browser = {
    tabs: {
      async new() {
        calls.push(["new"]);
        return createdTab;
      },
    },
  };

  const tab = await openStreamlineTab(browser);
  assert.equal(tab, createdTab);
  assert.deepEqual(calls, [
    ["new"],
    ["goto", "https://www.streamlinehq.com/icons/micro-solid"],
  ]);
});

test("runStreamlineSvgExtractionWithBrowser finalizes after extraction", async () => {
  const calls = [];
  const claimedTab = {
    id: "claimed",
    async close() {
      calls.push(["close"]);
    },
  };
  const browser = {
    async nameSession(name) {
      calls.push(["nameSession", name]);
    },
    user: {
      async openTabs() {
        calls.push(["openTabs"]);
        return [{ id: "2", url: "https://www.streamlinehq.com/icons/download/cut-scissor--26582" }];
      },
      async claimTab(tab) {
        calls.push(["claimTab", tab.id]);
        return claimedTab;
      },
    },
    tabs: {
      async finalize(options) {
        calls.push(["finalize", options]);
      },
    },
  };

  const result = await runStreamlineSvgExtractionWithBrowser({
    browser,
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json",
    sessionName: "test-session",
    runManifestExtraction: async ({ manifestPath, tab, attempts, waitMs }) => {
      calls.push(["runManifestExtraction", manifestPath, tab.id, attempts, waitMs]);
      return { success: 10, failed: 0 };
    },
    attempts: 8,
    waitMs: 123,
  });

  assert.deepEqual(result, { success: 10, failed: 0 });
  assert.deepEqual(calls, [
    ["nameSession", "test-session"],
    ["openTabs"],
    ["claimTab", "2"],
    ["runManifestExtraction", "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json", "claimed", 8, 123],
    ["close"],
    ["finalize", { keep: [] }],
  ]);
});

test("runStreamlineSvgExtractionWithBrowser forwards maxItems", async () => {
  const calls = [];
  const browser = {
    async nameSession() {},
    user: {
      async openTabs() {
        return [{ id: "2", url: "https://www.streamlinehq.com/icons/download/cut-scissor--26582" }];
      },
      async claimTab() {
        return {
          id: "claimed",
          async close() {},
        };
      },
    },
    tabs: {
      async finalize() {},
    },
  };

  await runStreamlineSvgExtractionWithBrowser({
    browser,
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json",
    maxItems: 5,
    runManifestExtraction: async (options) => {
      calls.push(options.maxItems);
      return { success: 5, failed: 0 };
    },
  });

  assert.deepEqual(calls, [5]);
});
