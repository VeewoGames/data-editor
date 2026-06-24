import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireReusableStreamlineTab,
  claimStreamlineTab,
  cleanupResidualStreamlineAgentTabs,
  findPreferredStreamlineTab,
  findReusableStreamlineAgentTab,
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

test("findPreferredStreamlineTab ignores non-detail Streamline tabs", () => {
  const tab = findPreferredStreamlineTab([
    { id: "1", url: "https://www.example.com/" },
    { id: "2", url: "https://www.streamlinehq.com/icons/micro-solid" },
  ]);

  assert.equal(tab, null);
});

test("findReusableStreamlineAgentTab prefers a matching handoff tab in the same session group", () => {
  const tab = findReusableStreamlineAgentTab([
    { id: "1", url: "https://www.streamlinehq.com/icons/download/foo--1", tabGroup: "other" },
    { id: "2", url: "https://www.streamlinehq.com/icons/download/bar--2", tabGroup: "🔎 Streamline Core batch" },
  ], "🔎 Streamline Core batch");

  assert.equal(tab?.id, "2");
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

test("claimStreamlineTab throws when only generic Streamline tabs exist", async () => {
  const browser = {
    user: {
      async openTabs() {
        return [{ id: "2", url: "https://home.streamlinehq.com/pricing" }];
      },
    },
  };

  await assert.rejects(
    () => claimStreamlineTab(browser),
    /No Streamline download tab found/,
  );
});

test("cleanupResidualStreamlineAgentTabs closes leftover profile and pricing tabs from agent groups", async () => {
  const calls = [];
  const browser = {
    user: {
      async openTabs() {
        return [
          { id: "1", url: "https://www.streamlinehq.com/profile", tabGroup: "🔎 Streamline Core batch" },
          { id: "2", url: "https://home.streamlinehq.com/pricing", tabGroup: "🔎 Streamline Core batch" },
          { id: "3", url: "https://www.streamlinehq.com/profile", tabGroup: "manual" },
          { id: "4", url: "https://www.streamlinehq.com/icons/download/cut-scissor--26582", tabGroup: "🔎 Streamline Core batch" },
        ];
      },
      async claimTab(tab) {
        return {
          async close() {
            calls.push(["close", tab.id]);
          },
        };
      },
    },
  };

  const closed = await cleanupResidualStreamlineAgentTabs(browser);
  assert.deepEqual(calls, [
    ["close", "1"],
    ["close", "2"],
  ]);
  assert.deepEqual(closed, [
    { id: "1", url: "https://www.streamlinehq.com/profile", tabGroup: "🔎 Streamline Core batch" },
    { id: "2", url: "https://home.streamlinehq.com/pricing", tabGroup: "🔎 Streamline Core batch" },
  ]);
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
  assert.deepEqual(calls, [["new"]]);
});

test("acquireReusableStreamlineTab claims an existing handoff tab when available", async () => {
  const claimed = { id: "claimed" };
  const browser = {
    user: {
      async openTabs() {
        return [
          { id: "1", url: "https://www.streamlinehq.com/icons/download/foo--1", tabGroup: "🔎 Streamline Core batch" },
        ];
      },
      async claimTab(tab) {
        assert.equal(tab.id, "1");
        return claimed;
      },
    },
  };

  const tab = await acquireReusableStreamlineTab(browser, { sessionName: "🔎 Streamline Core batch" });
  assert.equal(tab, claimed);
});

test("runStreamlineSvgExtractionWithBrowser finalizes after extraction", async () => {
  const calls = [];
  const openedTab = {
    id: "opened",
  };
  const browser = {
    async nameSession(name) {
      calls.push(["nameSession", name]);
    },
    user: {
      callCount: 0,
      async openTabs() {
        this.callCount += 1;
        calls.push(["openTabs", this.callCount]);
        if (this.callCount === 1) {
          return [];
        }
        return [{ id: "residual-1", url: "https://www.streamlinehq.com/profile", tabGroup: "🔎 Streamline batch" }];
      },
      async claimTab(tab) {
        calls.push(["claimTab", tab.id]);
        return {
          async close() {
            calls.push(["closeResidual", tab.id]);
          },
        };
      },
    },
    tabs: {
      async new() {
        calls.push(["new"]);
        return openedTab;
      },
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
    ["openTabs", 1],
    ["openTabs", 2],
    ["new"],
    ["runManifestExtraction", "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json", "opened", 8, 123],
    ["openTabs", 3],
    ["claimTab", "residual-1"],
    ["closeResidual", "residual-1"],
    ["finalize", { keep: [{ tab: openedTab, status: "handoff" }] }],
  ]);
});

test("runStreamlineSvgExtractionWithBrowser forwards maxItems", async () => {
  const calls = [];
  const browser = {
    async nameSession() {},
    user: {
      callCount: 0,
      async openTabs() {
        this.callCount += 1;
        return [];
      },
      async claimTab() {},
    },
    tabs: {
      async new() {
        return {
          id: "opened",
        };
      },
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
